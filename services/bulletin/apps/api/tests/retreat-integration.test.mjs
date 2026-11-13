import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID, webcrypto } from 'node:crypto';
import pg from 'pg';
import { Hono } from 'hono';
import { registerForRetreat, retreatRoutes } from '../.test-dist/retreats.js';
import { DEMO_EVENT_ID } from '../.test-dist/retreat-content.js';
import { cancelRegistration, correctParticipantName, memberView, registerForEvent, registrationView, updateMemberProfile } from '../.test-dist/event-domain.js';

globalThis.crypto ??= webcrypto;
const databaseUrl = process.env.EVENT_TEST_DATABASE_URL;
async function fixture(run) {
  const setupPool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const setup = await setupPool.connect();
  try {
    await setup.query('SELECT pg_advisory_lock(87361829)');
    try { await setup.query('CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public'); }
    finally { await setup.query('SELECT pg_advisory_unlock(87361829)'); }
  } finally { setup.release(); }
  const schema = `retreat_test_${randomUUID().replaceAll('-', '')}`;
  await setupPool.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 12, options: `-c search_path=${schema},public` });
  try {
    for (const file of ['schema.sql','event-schema.sql','event-sync-schema.sql','retreat-schema.sql','retreat-demo.sql']) {
      await pool.query(await readFile(new URL(`../db/${file}`, import.meta.url), 'utf8'));
    }
    await pool.query(`UPDATE events SET starts_at=now()+interval '30 days',ends_at=now()+interval '32 days',
      registration_opens_at=now()-interval '1 day',registration_closes_at=now()+interval '29 days',
      cancellation_closes_at=now()+interval '29 days' WHERE id=$1`, [DEMO_EVENT_ID]);
    await pool.query("INSERT INTO app_users(user_id,name,role) VALUES ('member','','user'),('admin','관리자','admin')");
    const actor = { userId: 'member', authVersion: 1 }, admin = { userId: 'admin', authVersion: 1 };
    const event = async () => (await pool.query('SELECT * FROM events WHERE id=$1', [DEMO_EVENT_ID])).rows[0];
    const input = async (fields = {}) => ({ participantName: '홍길동', peerGroup: '96또래', gender: 'male', phoneNumber: '010-1234-5678',
      departureOption: 'main', departureNote: null, prayerRequest: '개인 기도 제목', expectedEventVersion: (await event()).version, expectedRegistrationVersion: 0, ...fields });
    await run({ pool, actor, admin, event, input });
  } finally {
    await pool.end();
    await setupPool.query(`DROP SCHEMA ${schema} CASCADE`);
    await setupPool.end();
  }
}

test('PostgreSQL retreat: first application atomically fills missing reusable profile fields and saves event-only answers', { skip: !databaseUrl }, async () => fixture(async ({ pool, actor, input }) => {
  const result = await registerForRetreat(pool, actor, await input());
  const profile = (await pool.query("SELECT * FROM app_users WHERE user_id='member'")).rows[0];
  assert.equal(profile.name, '홍길동'); assert.equal(profile.peer_group, '96또래'); assert.equal(profile.gender, 'male'); assert.equal(profile.phone_number, '01012345678');
  assert.equal(profile.prayer_request, undefined); assert.equal(profile.departure_option, undefined);
  assert.equal(result.registration.retreat_answers.prayerRequest, '개인 기도 제목');
  assert.equal(result.registration.status, 'confirmed');
  assert.equal(memberView(profile).phoneNumber, '01012345678');
  const view = registrationView(result.registration, result.event);
  assert.equal(view.retreatSlug, 'nehemiah-winter'); assert.equal(view.answers.departureOption, 'main');
}));

test('PostgreSQL retreat: saved profile values cannot be changed by a forged form body', { skip: !databaseUrl }, async () => fixture(async ({ pool, actor, input }) => {
  await pool.query("UPDATE app_users SET name='홍길동',peer_group='96또래',gender='male',phone_number='01012345678' WHERE user_id='member'");
  for (const [key, value] of [['participantName','변조된 이름'],['peerGroup','다른 또래'],['gender','other'],['phoneNumber','01000000000']]) {
    const body = await input({ [key]: value });
    await assert.rejects(() => registerForRetreat(pool, actor, body), { code: 'PROFILE_FIELD_LOCKED' });
  }
  assert.equal((await pool.query('SELECT * FROM registrations')).rowCount, 0);
  assert.equal((await pool.query("SELECT version FROM app_users WHERE user_id='member'")).rows[0].version, 1);
  await registerForRetreat(pool, actor, await input());
}));

test('PostgreSQL retreat: duplicate/concurrent requests keep one row and cannot silently replace existing answers', { skip: !databaseUrl }, async () => fixture(async ({ pool, actor, input }) => {
  const body = await input();
  const results = await Promise.all(Array.from({ length: 12 }, () => registerForRetreat(pool, actor, body)));
  assert.equal(new Set(results.map((result) => result.registration.id)).size, 1);
  assert.equal((await pool.query('SELECT * FROM registrations')).rowCount, 1);
  assert.equal((await pool.query("SELECT version FROM app_users WHERE user_id='member'")).rows[0].version, 2);
  await assert.rejects(() => registerForRetreat(pool, actor, { ...body, prayerRequest: '몰래 변경' }), { code: 'RETREAT_ALREADY_REGISTERED' });
  assert.equal((await pool.query('SELECT retreat_answers FROM registrations')).rows[0].retreat_answers.prayerRequest, '개인 기도 제목');
}));

test('PostgreSQL retreat: generic application/name routes cannot bypass the retreat form or locked identity', { skip: !databaseUrl }, async () => fixture(async ({ pool, actor, admin, event, input }) => {
  const target = await event();
  await assert.rejects(() => registerForEvent(pool, actor, DEMO_EVENT_ID, { participantName: '우회', expectedEventVersion: target.version, expectedRegistrationVersion: 0 }), { code: 'RETREAT_FORM_REQUIRED' });
  const created = await registerForRetreat(pool, actor, await input());
  for (const caller of [actor, admin]) {
    await assert.rejects(() => correctParticipantName(pool, caller, created.registration.id, '우회 이름', created.registration.version), { code: 'RETREAT_PROFILE_LOCKED' });
  }
  const updated = await updateMemberProfile(pool, actor, { name: '새 이름', peerGroup: '97또래', gender: 'other', phoneNumber: '010 7777 8888' });
  assert.equal(updated.name, '새 이름'); assert.equal(updated.phone_number, '01077778888');
  assert.equal((await pool.query('SELECT participant_name FROM registrations')).rows[0].participant_name, '홍길동');
  await assert.rejects(() => updateMemberProfile(pool, actor, { role: 'admin' }));
}));

test('PostgreSQL retreat: cancellation/reapplication use the same row, replace event answers explicitly and reject late cancellation', { skip: !databaseUrl }, async () => fixture(async ({ pool, actor, input }) => {
  const first = await registerForRetreat(pool, actor, await input());
  const cancelled = await cancelRegistration(pool, actor, first.registration.id, first.registration.version);
  const again = await registerForRetreat(pool, actor, await input({ expectedRegistrationVersion: cancelled.registration.version,
    departureOption: 'car', departureNote: '금요일 오후 5시 출발', prayerRequest: null }));
  assert.equal(again.registration.id, first.registration.id); assert.notEqual(again.registration.confirmation_code, first.registration.confirmation_code);
  assert.equal(again.registration.retreat_answers.departureOption, 'car'); assert.equal(again.registration.retreat_answers.prayerRequest, null);
  await assert.rejects(() => cancelRegistration(pool, actor, first.registration.id, first.registration.version), { code: 'REGISTRATION_CHANGED' });
}));

test('PostgreSQL retreat: rejection for stale event/deadline/member/auth rules never fills the profile or creates registration', { skip: !databaseUrl }, async () => fixture(async ({ pool, actor, event, input }) => {
  const stale = await input({ expectedEventVersion: 99 });
  await assert.rejects(() => registerForRetreat(pool, actor, stale), { code: 'EVENT_CHANGED' });
  await pool.query("UPDATE events SET registration_closes_at=now()-interval '1 minute' WHERE id=$1", [DEMO_EVENT_ID]);
  const closed = await input(); await assert.rejects(() => registerForRetreat(pool, actor, closed), { code: 'REGISTRATION_CLOSED' });
  await pool.query("UPDATE events SET registration_closes_at=now()+interval '29 days',requires_member_verification=true WHERE id=$1", [DEMO_EVENT_ID]);
  const unverified = await input(); await assert.rejects(() => registerForRetreat(pool, actor, unverified), { code: 'MEMBER_VERIFICATION_REQUIRED' });
  await pool.query("UPDATE app_users SET auth_version=2 WHERE user_id='member'");
  const oldSession = await input(); await assert.rejects(() => registerForRetreat(pool, actor, oldSession), { code: 'SESSION_EXPIRED' });
  assert.equal((await pool.query('SELECT * FROM registrations')).rowCount, 0);
  const member = (await pool.query("SELECT * FROM app_users WHERE user_id='member'")).rows[0];
  assert.equal(member.name, ''); assert.equal(member.peer_group, null); assert.equal(member.phone_number, null);
}));

test('PostgreSQL retreat: late registration failure rolls back newly filled profile and all sensitive answers', { skip: !databaseUrl }, async () => fixture(async ({ pool, actor, input }) => {
  await pool.query(`CREATE FUNCTION reject_retreat() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected registration failure'; END; $$;
    CREATE TRIGGER reject_retreat BEFORE INSERT ON registrations FOR EACH ROW EXECUTE FUNCTION reject_retreat();`);
  const body = await input();
  await assert.rejects(() => registerForRetreat(pool, actor, body), /injected registration failure/);
  const profile = (await pool.query("SELECT * FROM app_users WHERE user_id='member'")).rows[0];
  assert.equal(profile.name, ''); assert.equal(profile.peer_group, null); assert.equal(profile.gender, null); assert.equal(profile.phone_number, null); assert.equal(profile.version, 1);
  assert.equal((await pool.query('SELECT * FROM registrations')).rowCount, 0);
}));

test('PostgreSQL retreat HTTP: guest can read the fictional form content but cannot submit/read private answers', { skip: !databaseUrl }, async () => fixture(async ({ pool, actor, input }) => {
  await registerForRetreat(pool, actor, await input());
  const api = new Hono();
  api.use('*', async (c, next) => { c.set('pool', pool); await next(); });
  api.route('/v1', retreatRoutes);
  const response = await api.request('/v1/retreats/nehemiah-winter');
  assert.equal(response.status, 200);
  const data = await response.json(); assert.equal(data.retreat.isDemo, true); assert.equal(data.retreat.departureOptions.length, 4);
  const text = JSON.stringify(data); assert.equal(text.includes('홍길동'), false); assert.equal(text.includes('01012345678'), false); assert.equal(text.includes('개인 기도 제목'), false);
  assert.equal(data.retreat.event.memberDetails, undefined); assert.equal(data.retreat.event.retreat_answers, undefined);
  assert.equal((await api.request('/v1/me/retreats/nehemiah-winter/registration')).status, 401);
  const rejected = await api.request('/v1/retreats/nehemiah-winter/registrations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(await input()) });
  assert.equal(rejected.status, 401); assert.equal((await pool.query('SELECT * FROM registrations')).rowCount, 1);
}));
