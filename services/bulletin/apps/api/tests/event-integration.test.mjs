import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID, webcrypto } from 'node:crypto';
import pg from 'pg';
import { Hono } from 'hono';
import { eventRoutes } from '../.test-dist/events.js';
import { registerForEvent, cancelRegistration, setAttendance, correctParticipantName, registrationView } from '../.test-dist/event-domain.js';
import { getBulletin, getPromotionCalendarEvents, replaceBulletin, transaction } from '../.test-dist/db.js';
import { bulletinInput } from '../.test-dist/validation.js';

globalThis.crypto ??= webcrypto;
const databaseUrl = process.env.EVENT_TEST_DATABASE_URL;

async function fixture(run) {
  const admin = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const setup = await admin.connect();
  try {
    // Shared extensions must outlive each isolated test schema, including parallel suites.
    await setup.query('SELECT pg_advisory_lock(87361829)');
    try { await setup.query('CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public'); }
    finally { await setup.query('SELECT pg_advisory_unlock(87361829)'); }
  } finally { setup.release(); }
  const schema = `event_test_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 12, options: `-c search_path=${schema},public` });
  try {
    await pool.query(await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8'));
    await pool.query(await readFile(new URL('../db/event-schema.sql', import.meta.url), 'utf8'));
    const user = async (id, fields = {}) => {
      await pool.query('INSERT INTO app_users (user_id,name,role,is_member_verified) VALUES ($1,$1,$2,$3)', [id, fields.role || 'user', fields.verified || false]);
      return { userId: id, authVersion: 1 };
    };
    const event = async (fields = {}) => (await pool.query(`INSERT INTO events
      (title,starts_at,registration_opens_at,registration_closes_at,cancellation_closes_at,publication_status,
       registration_enabled,requires_member_verification,member_details)
      VALUES ($1,now()+interval '10 days',now()-interval '1 day',now()+interval '9 days',now()+interval '9 days','published',true,$2,'private notes') RETURNING *`,
    [fields.title || '행사', fields.memberOnly || false])).rows[0];
    const apply = (actor, event, version = 0) => registerForEvent(pool, actor, event.id, { participantName: actor.userId, expectedEventVersion: event.version, expectedRegistrationVersion: version });
    await run({ pool, user, event, apply });
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
}

test('PostgreSQL events: concurrent requests create exactly one registration; different users have no capacity limit', { skip: !databaseUrl }, async () => fixture(async ({ pool, user, event, apply }) => {
  const first = await user('first'); const target = await event();
  const duplicate = await Promise.all(Array.from({ length: 12 }, () => apply(first, target)));
  assert.equal(new Set(duplicate.map((result) => result.registration.id)).size, 1);
  const others = await Promise.all(Array.from({ length: 16 }, (_, i) => user(`person-${i}`)));
  await Promise.all(others.map((actor) => apply(actor, target)));
  assert.equal((await pool.query('SELECT * FROM registrations WHERE event_id=$1', [target.id])).rowCount, 17);
}));

test('PostgreSQL events: cancellation/reapplication preserve ID and reject old requests', { skip: !databaseUrl }, async () => fixture(async ({ pool, user, event, apply }) => {
  const actor = await user('participant'); const target = await event();
  const first = await apply(actor, target);
  const cancelled = await cancelRegistration(pool, actor, first.registration.id, first.registration.version);
  await assert.rejects(() => apply(actor, target), { code: 'REGISTRATION_CHANGED' });
  const again = await apply(actor, target, cancelled.registration.version);
  assert.equal(again.registration.id, first.registration.id);
  assert.notEqual(again.registration.confirmation_code, first.registration.confirmation_code);
  await assert.rejects(() => cancelRegistration(pool, actor, first.registration.id, first.registration.version), { code: 'REGISTRATION_CHANGED' });
  assert.equal((await pool.query('SELECT status FROM registrations')).rows[0].status, 'confirmed');
}));

test('PostgreSQL events: attendee cannot change another registration or mark attendance; administrator can correct it', { skip: !databaseUrl }, async () => fixture(async ({ pool, user, event, apply }) => {
  const actor = await user('participant'); const other = await user('other'); const admin = await user('admin', { role: 'admin' });
  const target = await event(); const created = (await apply(actor, target)).registration;
  await assert.rejects(() => cancelRegistration(pool, other, created.id, created.version), { code: 'FORBIDDEN' });
  await assert.rejects(() => setAttendance(pool, actor, created.id, { expectedVersion: created.version, attendanceStatus: 'present' }), { code: 'FORBIDDEN' });
  const checked = await setAttendance(pool, admin, created.id, { expectedVersion: created.version, attendanceStatus: 'present' });
  await assert.rejects(() => cancelRegistration(pool, actor, created.id, checked.registration.version), { code: 'ATTENDANCE_LOCKED' });
  await assert.rejects(() => correctParticipantName(pool, actor, created.id, '새 이름', checked.registration.version), { code: 'ATTENDANCE_LOCKED' });
  const corrected = await correctParticipantName(pool, admin, created.id, '정정된 이름', checked.registration.version);
  assert.equal(corrected.registration.participant_name, '정정된 이름');
  assert.equal(corrected.registration.checked_by, 'admin');
}));

test('PostgreSQL events: an admin acting through the user API obeys ownership, attendance and cancellation deadlines', { skip: !databaseUrl }, async () => fixture(async ({ pool, user, event, apply }) => {
  const admin = await user('administrator', { role: 'admin' });
  const participant = await user('participant');
  const target = await event();
  const other = (await apply(participant, target)).registration;
  const own = (await apply(admin, target)).registration;
  const userAccess = { ...admin, access: 'user' };
  await assert.rejects(() => cancelRegistration(pool, userAccess, other.id, other.version), { code: 'FORBIDDEN' });
  await assert.rejects(() => correctParticipantName(pool, userAccess, other.id, '다른 이름', other.version), { code: 'FORBIDDEN' });
  const checked = (await setAttendance(pool, admin, own.id, { expectedVersion: own.version, attendanceStatus: 'present' })).registration;
  await assert.rejects(() => cancelRegistration(pool, userAccess, checked.id, checked.version), { code: 'ATTENDANCE_LOCKED' });
  await assert.rejects(() => correctParticipantName(pool, userAccess, checked.id, '다른 이름', checked.version), { code: 'ATTENDANCE_LOCKED' });
  const reset = (await setAttendance(pool, admin, own.id, { expectedVersion: checked.version, attendanceStatus: 'unmarked' })).registration;
  await pool.query("UPDATE events SET cancellation_closes_at=now()-interval '1 minute' WHERE id=$1", [target.id]);
  await assert.rejects(() => cancelRegistration(pool, userAccess, reset.id, reset.version), { code: 'CANCELLATION_CLOSED' });
  assert.equal((await cancelRegistration(pool, admin, reset.id, reset.version)).registration.status, 'cancelled');
}));

test('PostgreSQL events: concurrent cancellation and attendance cannot leave a cancelled attendee marked present', { skip: !databaseUrl }, async () => fixture(async ({ pool, user, event, apply }) => {
  const actor = await user('participant'); const admin = await user('admin', { role: 'admin' });
  const target = await event(); const created = (await apply(actor, target)).registration;
  const results = await Promise.allSettled([
    cancelRegistration(pool, actor, created.id, created.version),
    setAttendance(pool, admin, created.id, { expectedVersion: created.version, attendanceStatus: 'present' }),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const row = (await pool.query('SELECT * FROM registrations')).rows[0];
  assert.ok((row.status === 'cancelled' && row.attendance_status === 'unmarked') || (row.status === 'confirmed' && row.attendance_status === 'present'));
}));

test('PostgreSQL events: membership, auth epoch and account lifecycle are checked from locked rows', { skip: !databaseUrl }, async () => fixture(async ({ pool, user, event, apply }) => {
  const actor = await user('participant'); const target = await event({ memberOnly: true });
  await assert.rejects(() => apply(actor, target), { code: 'MEMBER_VERIFICATION_REQUIRED' });
  await pool.query('UPDATE app_users SET is_member_verified=true,auth_version=2 WHERE user_id=$1', [actor.userId]);
  await assert.rejects(() => apply(actor, target), { code: 'SESSION_EXPIRED' });
  const current = { ...actor, authVersion: 2 };
  await apply(current, target);
  await pool.query("UPDATE app_users SET status='deleting' WHERE user_id=$1", [actor.userId]);
  await assert.rejects(() => apply(current, target), { code: 'ACCOUNT_UNAVAILABLE' });
}));

test('PostgreSQL events: a queued application observes event cancellation committed while it waited', { skip: !databaseUrl }, async () => fixture(async ({ pool, user, event, apply }) => {
  const actor = await user('participant'); const target = await event();
  const control = await pool.connect();
  try {
    await control.query('BEGIN');
    await control.query('SELECT id FROM events WHERE id=$1 FOR UPDATE', [target.id]);
    const queued = apply(actor, target);
    // Attach a handler immediately; assertion below still checks the actual rejection.
    queued.catch(() => {});
    await control.query("UPDATE events SET lifecycle_status='cancelled',cancelled_at=now() WHERE id=$1", [target.id]);
    await control.query('COMMIT');
    await assert.rejects(() => queued, { code: 'REGISTRATION_CLOSED' });
    assert.equal((await pool.query('SELECT * FROM registrations')).rowCount, 0);
  } finally { control.release(); }
}));

test('PostgreSQL events: stale event versions require re-confirmation and hidden/cancelled history does not expose private notes', { skip: !databaseUrl }, async () => fixture(async ({ pool, user, event, apply }) => {
  const actor = await user('participant'); const target = await event();
  await pool.query("UPDATE events SET location='새 장소',version=version+1 WHERE id=$1", [target.id]);
  await assert.rejects(() => apply(actor, target), { code: 'EVENT_CHANGED' });
  const current = (await pool.query('SELECT * FROM events')).rows[0];
  const created = await apply(actor, current);
  await pool.query("UPDATE events SET publication_status='hidden',lifecycle_status='cancelled' WHERE id=$1", [target.id]);
  const closed = (await pool.query('SELECT * FROM events')).rows[0];
  const view = registrationView(created.registration, closed);
  assert.equal(view.effectiveStatus, 'event_cancelled');
  assert.equal(view.event.memberDetails, undefined);
}));

test('PostgreSQL events HTTP: anonymous field whitelist, private visibility, pagination and protected routes use the real server', { skip: !databaseUrl }, async () => fixture(async ({ pool, event }) => {
  for (let i = 0; i < 5; i++) await event({ title: `공개 행사 ${i}` });
  const hidden = await event({ title: '회원 전용' });
  await pool.query("UPDATE events SET visibility='members' WHERE id=$1", [hidden.id]);
  const draft = await event({ title: '게시 전 행사' });
  await pool.query("UPDATE events SET publication_status='draft' WHERE id=$1", [draft.id]);
  const api = new Hono();
  api.use('*', async (c, next) => { c.set('pool', pool); await next(); });
  api.route('/v1', eventRoutes);
  const env = { BETTER_AUTH_SECRET: 'local-test-only-secret-for-anonymous-http-validation',
    BETTER_AUTH_URL: 'http://localhost:8787', WEB_ORIGIN: 'http://localhost:8081', MOBILE_APP_ORIGIN: 'itda://' };
  const observed = [];
  let cursor;
  do {
    const response = await api.request(`/v1/events?limit=2${cursor ? `&cursor=${cursor}` : ''}`, {}, env);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.ok(payload.items.every((item) => item.memberDetails === undefined && item.sourcePromotionId === undefined));
    observed.push(...payload.items.map((item) => item.id));
    cursor = payload.nextCursor;
  } while (cursor);
  assert.equal(observed.length, 5); assert.equal(new Set(observed).size, 5);
  assert.equal((await api.request(`/v1/events/${hidden.id}`, {}, env)).status, 404);
  assert.equal((await api.request(`/v1/events/${draft.id}`, {}, env)).status, 404);
  assert.equal((await api.request('/v1/me/registrations', {}, env)).status, 401);
  assert.equal((await api.request('/v1/admin/event-sources', {}, env)).status, 401);
}));

test('PostgreSQL events: bulletin edits/reordering preserve promotion identity and the app/calendar share canonical event rows', { skip: !databaseUrl }, async () => fixture(async ({ pool, user, event, apply }) => {
  const bulletinId = (await pool.query("INSERT INTO bulletins (service_date,status) VALUES ('2026-11-22','published') RETURNING id")).rows[0].id;
  const base = { serviceDate: '2026-11-22', theme: '', coverMediaId: null, coverAltText: '', sermonTitle: '', scripture: '', preacher: '', worshipItems: [], communityNews: [],
    promotions: [
      { title: '행사 광고', body: '공개 안내', url: '', details: [{ type: 'schedule', title: '예전 장소 일정', schedule: { startDate: '2026-12-01' } }] },
      { title: '다른 광고', body: '안내', url: '', details: [] },
    ] };
  await transaction(pool, (client) => replaceBulletin(client, bulletinId, bulletinInput.parse(base)));
  const first = await getBulletin(pool, 'b.id=$1', bulletinId);
  const ids = first.promotions.map((promotion) => promotion.id);
  await transaction(pool, (client) => replaceBulletin(client, bulletinId, bulletinInput.parse({ ...base, promotions: [...first.promotions].reverse() })));
  const reordered = await getBulletin(pool, 'b.id=$1', bulletinId);
  assert.deepEqual(reordered.promotions.map((promotion) => promotion.id), [...ids].reverse());
  await transaction(pool, (client) => replaceBulletin(client, bulletinId, bulletinInput.parse({ ...base,
    promotions: [{ title: '새 광고', body: '새 안내', url: '', details: [] }, ...reordered.promotions] })));
  const inserted = await getBulletin(pool, 'b.id=$1', bulletinId);
  assert.ok(!ids.includes(inserted.promotions[0].id));
  assert.deepEqual(inserted.promotions.slice(1).map((promotion) => promotion.id), [...ids].reverse());
  const canonical = await event({ title: '공통 원본 행사' });
  await pool.query('UPDATE events SET source_promotion_id=$2 WHERE id=$1', [canonical.id, ids[0]]);
  const calendar = await getPromotionCalendarEvents(pool);
  assert.equal(calendar.filter((item) => item.sourceEventId === canonical.id).length, 1);
  assert.equal(calendar.some((item) => item.title === '예전 장소 일정'), false);
  const actor = await user('participant'); await apply(actor, canonical);
  await transaction(pool, (client) => replaceBulletin(client, bulletinId, bulletinInput.parse({ ...base, promotions: [] })));
  assert.equal((await pool.query('SELECT * FROM registrations')).rowCount, 1);
  assert.equal((await pool.query('SELECT source_promotion_id FROM events')).rows[0].source_promotion_id, null);
  assert.ok((await getPromotionCalendarEvents(pool)).some((item) => item.sourceEventId === canonical.id));
}));
