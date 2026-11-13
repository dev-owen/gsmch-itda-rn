import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID, webcrypto } from 'node:crypto';
import pg from 'pg';
import { applyBulletinSnapshot, changeSourceSyncMode, recordSyncFailure, getSyncStatus } from '../.test-dist/event-sync-store.js';
import { updateEventForAdmin, registerForEvent, setAttendance, adminEvent, publicEvent } from '../.test-dist/event-domain.js';

globalThis.crypto ??= webcrypto;
const databaseUrl = process.env.EVENT_TEST_DATABASE_URL;
const sourceSystem = 'https://bulletin.example.test';
const baseFields = { title: '겨울 수련회', category: 'event', description: '원문 안내', location: '본당', target: '청년',
  startsAt: '2099-11-20T01:00:00.000Z', endsAt: '2099-11-20T03:00:00.000Z', allDay: false };
function source(overrides = {}) {
  const fields = { ...baseFields, ...(overrides.fields || {}) };
  return { sourceId: 'advertisement-a', identityKey: JSON.stringify([fields.title,fields.startsAt,fields.endsAt,fields.allDay]),
    bulletinId: 'bulletin-a', bulletinDate: '2026-11-15', sourceUrl: `${sourceSystem}/?date=2026-11-15`,
    reviewRequired: false, warnings: [], ...overrides, fields };
}
function snapshot(events, overrides = {}) { return { sourceSystem, bulletinId: 'bulletin-a', bulletinDate: '2026-11-15', events, ...overrides }; }
async function fixture(run) {
  const adminPool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const setup = await adminPool.connect();
  try {
    await setup.query('SELECT pg_advisory_lock(87361829)');
    try { await setup.query('CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public'); }
    finally { await setup.query('SELECT pg_advisory_unlock(87361829)'); }
  } finally { setup.release(); }
  const schema = `sync_test_${randomUUID().replaceAll('-', '')}`;
  await adminPool.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 8, options: `-c search_path=${schema},public` });
  try {
    for (const file of ['schema.sql', 'event-schema.sql', 'event-sync-schema.sql']) {
      await pool.query(await readFile(new URL(`../db/${file}`, import.meta.url), 'utf8'));
    }
    await pool.query("INSERT INTO app_users(user_id,name,role,is_member_verified) VALUES ('admin','관리자','admin',true),('member','성도','user',true)");
    const admin = { userId: 'admin', authVersion: 1 }, member = { userId: 'member', authVersion: 1 };
    const current = async () => (await pool.query('SELECT * FROM events ORDER BY id')).rows[0];
    const sync = (items = [source()], overrides = {}) => applyBulletinSnapshot(pool, snapshot(items, overrides), 'manual');
    const register = async () => {
      let row = await current();
      row = await updateEventForAdmin(pool, admin, row.id, { expectedVersion: row.version, registrationEnabled: true,
        registrationClosesAt: '2099-11-19T01:00:00.000Z', cancellationClosesAt: '2099-11-19T01:00:00.000Z' });
      return registerForEvent(pool, member, row.id, { participantName: '성도', expectedEventVersion: row.version, expectedRegistrationVersion: 0 });
    };
    await run({ pool, admin, member, sync, current, register });
  } finally {
    await pool.end();
    await adminPool.query(`DROP SCHEMA ${schema} CASCADE`);
    await adminPool.end();
  }
}

test('PostgreSQL sync: repeated snapshots preserve IDs/versions and expose only a safe public source URL', { skip: !databaseUrl }, async () => fixture(async ({ pool, sync, current }) => {
  assert.equal((await sync()).created, 1);
  const first = await current();
  assert.equal(first.publication_status, 'published'); assert.equal(first.registration_enabled, false);
  const second = await sync();
  assert.equal(second.unchanged, 1); assert.equal((await current()).version, first.version);
  assert.equal((await pool.query('SELECT * FROM event_source_aliases')).rowCount, 1);
  const dto = publicEvent(first);
  assert.equal(dto.sourceUrl, source().sourceUrl); assert.equal(dto.source, undefined); assert.equal(dto.source_snapshot, undefined);
  assert.equal(adminEvent(first).source.kind, 'bulletin');
}));

test('PostgreSQL sync: bulletin IDs changing next week create aliases while preserving registrations', { skip: !databaseUrl }, async () => fixture(async ({ pool, sync, current, register }) => {
  await sync(); const before = await current(); const created = await register();
  const next = source({ sourceId: 'advertisement-next-week', bulletinId: 'bulletin-b', bulletinDate: '2026-11-22', sourceUrl: `${sourceSystem}/?date=2026-11-22` });
  await sync([next], { bulletinId: 'bulletin-b', bulletinDate: '2026-11-22' });
  assert.equal((await current()).id, before.id);
  assert.equal((await pool.query('SELECT * FROM events')).rowCount, 1);
  assert.equal((await pool.query('SELECT * FROM event_source_aliases')).rowCount, 2);
  assert.equal((await pool.query('SELECT id FROM registrations')).rows[0].id, created.registration.id);
}));

test('PostgreSQL sync: source updates cannot change application policy, private content, cancellation, roles or attendance', { skip: !databaseUrl }, async () => fixture(async ({ pool, admin, sync, current, register }) => {
  await sync(); const created = await register();
  await setAttendance(pool, admin, created.registration.id, { attendanceStatus: 'present', expectedVersion: created.registration.version });
  let row = await current();
  row = await updateEventForAdmin(pool, admin, row.id, { expectedVersion: row.version, memberDetails: '내부 안내', visibility: 'members',
    requiresMemberVerification: true, publicationStatus: 'hidden', lifecycleStatus: 'cancelled', registrationEnabled: false });
  assert.equal(row.sync_mode, 'automatic');
  await sync([source({ fields: { title: '수정된 수련회', description: '수정된 원문' } })]);
  row = await current();
  assert.equal(row.title, '수정된 수련회'); assert.equal(row.member_details, '내부 안내');
  assert.equal(row.visibility, 'members'); assert.equal(row.requires_member_verification, true);
  assert.equal(row.publication_status, 'hidden'); assert.equal(row.lifecycle_status, 'cancelled'); assert.equal(row.registration_enabled, false);
  assert.equal((await pool.query('SELECT attendance_status FROM registrations')).rows[0].attendance_status, 'present');
  assert.equal((await pool.query("SELECT role FROM app_users WHERE user_id='member'")).rows[0].role, 'user');
}));

test('PostgreSQL sync: manual content edits preserve overrides and explicit resume applies the latest preview', { skip: !databaseUrl }, async () => fixture(async ({ pool, admin, member, sync, current }) => {
  await sync(); let row = await current();
  row = await updateEventForAdmin(pool, admin, row.id, { expectedVersion: row.version, description: '잇다에서 직접 작성' });
  assert.equal(row.sync_mode, 'manual'); assert.equal(row.source_pending, true);
  await sync([source({ fields: { description: '나중에 수정된 원문' } })]);
  row = await current(); assert.equal(row.description, '잇다에서 직접 작성');
  assert.equal(row.source_snapshot.description, '나중에 수정된 원문'); assert.equal(row.source_pending, true);
  await assert.rejects(() => changeSourceSyncMode(pool, member, row.id, 'automatic', row.version), { code: 'FORBIDDEN' });
  await assert.rejects(() => changeSourceSyncMode(pool, admin, row.id, 'automatic', row.version - 1), { code: 'EVENT_CHANGED' });
  row = await changeSourceSyncMode(pool, admin, row.id, 'automatic', row.version);
  assert.equal(row.description, '나중에 수정된 원문'); assert.equal(row.sync_mode, 'automatic'); assert.equal(row.source_pending, false);
}));

test('PostgreSQL sync: active participants hold schedule/location changes until explicit administrator confirmation', { skip: !databaseUrl }, async () => fixture(async ({ pool, admin, sync, current, register }) => {
  await sync(); const created = await register();
  const next = source({ fields: { startsAt: '2099-11-21T01:00:00.000Z', endsAt: '2099-11-21T03:00:00.000Z', location: '수양관' } });
  const result = await sync([next]); assert.equal(result.pending, 1);
  let row = await current(); assert.equal(row.location, '본당'); assert.equal(row.source_sync_error, 'ACTIVE_REGISTRATIONS_REQUIRE_REVIEW');
  row = await changeSourceSyncMode(pool, admin, row.id, 'automatic', row.version);
  assert.equal(row.location, '수양관'); assert.equal(row.starts_at.toISOString(), next.fields.startsAt);
  assert.equal((await pool.query('SELECT id FROM registrations')).rows[0].id, created.registration.id);
}));

test('PostgreSQL sync: invalid combined registration settings stay pending without losing the source snapshot', { skip: !databaseUrl }, async () => fixture(async ({ pool, admin, sync, current }) => {
  await sync(); let row = await current();
  await updateEventForAdmin(pool, admin, row.id, { expectedVersion: row.version, registrationEnabled: true, registrationClosesAt: '2099-11-19T01:00:00.000Z' });
  await sync([source({ fields: { startsAt: '2099-11-18T01:00:00.000Z', endsAt: '2099-11-18T03:00:00.000Z' } })]);
  row = await current(); assert.equal(row.source_sync_error, 'SOURCE_CONFLICTS_WITH_REGISTRATION_SETTINGS');
  assert.equal(row.starts_at.toISOString(), baseFields.startsAt);
  await assert.rejects(() => changeSourceSyncMode(pool, admin, row.id, 'automatic', row.version), { code: 'SOURCE_CONFLICTS_WITH_REGISTRATION_SETTINGS' });
  row = await updateEventForAdmin(pool, admin, row.id, { expectedVersion: row.version, registrationClosesAt: '2099-11-17T01:00:00.000Z' });
  row = await changeSourceSyncMode(pool, admin, row.id, 'automatic', row.version);
  assert.equal(row.starts_at.toISOString(), '2099-11-18T01:00:00.000Z');
}));

test('PostgreSQL sync: disappeared source marks missing without cancellation/deletion and cannot resume an obsolete snapshot', { skip: !databaseUrl }, async () => fixture(async ({ pool, admin, sync, current, register }) => {
  await sync(); const created = await register();
  assert.equal((await sync([])).missing, 1);
  let row = await current(); assert.equal(row.source_missing, true); assert.equal(row.lifecycle_status, 'active');
  assert.equal((await pool.query('SELECT id FROM registrations')).rows[0].id, created.registration.id);
  await assert.rejects(() => changeSourceSyncMode(pool, admin, row.id, 'automatic', row.version), { code: 'SOURCE_MISSING' });
  row = await changeSourceSyncMode(pool, admin, row.id, 'manual', row.version);
  await sync(); assert.equal((await current()).source_missing, false); assert.equal((await current()).sync_mode, 'manual');
}));

test('PostgreSQL sync: ambiguous dates remain drafts and never alias across different bulletin source IDs', { skip: !databaseUrl }, async () => fixture(async ({ pool, sync }) => {
  const uncertain = { startsAt: null, endsAt: null };
  await sync([source({ reviewRequired: true, warnings: ['AMBIGUOUS_SCHEDULE'], fields: uncertain })]);
  await sync([source({ sourceId: 'next-ambiguous', bulletinId: 'bulletin-b', bulletinDate: '2026-11-22', reviewRequired: true, warnings: ['AMBIGUOUS_SCHEDULE'], fields: uncertain })],
    { bulletinId: 'bulletin-b', bulletinDate: '2026-11-22' });
  const rows = (await pool.query('SELECT * FROM events')).rows;
  assert.equal(rows.length, 2); assert.ok(rows.every((row) => row.publication_status === 'draft' && row.source_pending));
}));

test('PostgreSQL sync: older response completion and older bulletin dates cannot overwrite newer data or mark it missing', { skip: !databaseUrl }, async () => fixture(async ({ sync, current }) => {
  const early = new Date(Date.now() - 2000).toISOString(), late = new Date(Date.now() - 1000).toISOString();
  await sync([source({ fields: { description: '최신 원문' } })], { requestedAt: late });
  const before = await current();
  assert.equal((await sync([], { requestedAt: early })).errorCode, 'STALE_SOURCE_RESPONSE');
  assert.equal((await sync([], { bulletinDate: '2026-11-08' })).status, 'skipped');
  const row = await current(); assert.equal(row.description, '최신 원문'); assert.equal(row.version, before.version); assert.equal(row.source_missing, false);
}));

test('PostgreSQL sync: metadata-only source changes bump versions and failed fetch reports never alter events', { skip: !databaseUrl }, async () => fixture(async ({ pool, admin, sync, current }) => {
  await sync(); const before = await current();
  await sync([source({ sourceUrl: `${sourceSystem}/different`, warnings: ['MISSING_PROMOTION_ID'] })]);
  const after = await current(); assert.equal(after.version, before.version + 1);
  await assert.rejects(() => updateEventForAdmin(pool, admin, after.id, { expectedVersion: before.version, description: '오래된 편집' }), { code: 'EVENT_CHANGED' });
  const statusBefore = await getSyncStatus(pool);
  await recordSyncFailure(pool, 'scheduled', 'INVALID_SOURCE_JSON');
  const statusAfter = await getSyncStatus(pool); assert.equal(statusAfter.lastRun.status, 'failed');
  assert.equal(statusAfter.lastSuccessAt, statusBefore.lastSuccessAt); assert.equal((await current()).version, after.version);
}));

test('PostgreSQL sync: concurrent runs are serialized and late SQL failure rolls back all event/alias writes', { skip: !databaseUrl }, async () => fixture(async ({ pool, sync }) => {
  const results = await Promise.all(Array.from({ length: 6 }, () => sync()));
  assert.ok(results.some((result) => result.status === 'success')); assert.ok(results.every((result) => ['success','skipped'].includes(result.status)));
  assert.equal((await pool.query('SELECT * FROM events')).rowCount, 1); assert.equal((await pool.query('SELECT * FROM event_source_aliases')).rowCount, 1);
  await pool.query(`CREATE FUNCTION reject_success() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.status='success' THEN RAISE EXCEPTION 'injected sync failure'; END IF; RETURN NEW; END; $$;
    CREATE TRIGGER reject_success BEFORE INSERT ON event_sync_runs FOR EACH ROW EXECUTE FUNCTION reject_success();`);
  await assert.rejects(() => sync([source({ sourceId: 'different', fields: { title: '신규 행사' } })]), /injected sync failure/);
  assert.equal((await pool.query('SELECT * FROM events')).rowCount, 1); assert.equal((await pool.query('SELECT * FROM event_source_aliases')).rowCount, 1);
}));
