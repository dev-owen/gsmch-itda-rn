import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID, webcrypto } from 'node:crypto';
import pg from 'pg';
import { prepareOperation, proveMerge, previewMerge, confirmMerge, approveMerge,
  readRecentProof, unlinkLogin, previewDeletion, confirmDeletion } from '../.test-dist/account-store.js';

globalThis.crypto ??= webcrypto;
const databaseUrl = process.env.ACCOUNT_TEST_DATABASE_URL;
const secret = 'local-test-only-high-entropy-account-operation-secret';
const retreatAnswers = (fields = {}) => ({ peerGroup: '99', gender: 'female', phoneNumber: '01012345678',
  departureOption: 'main', departureNote: null, prayerRequest: 'PRIVATE_RETREAT_PRAYER', ...fields });
const authSchema = `
CREATE TABLE "user" (id text PRIMARY KEY,name text NOT NULL,email text NOT NULL UNIQUE,"emailVerified" boolean NOT NULL DEFAULT false,
image text,"createdAt" timestamptz NOT NULL DEFAULT now(),"updatedAt" timestamptz NOT NULL DEFAULT now());
CREATE TABLE "account" (id text PRIMARY KEY,"userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
"providerId" text NOT NULL,"accountId" text NOT NULL,"createdAt" timestamptz NOT NULL DEFAULT now(),"updatedAt" timestamptz NOT NULL DEFAULT now(),
UNIQUE("providerId","accountId"));
CREATE TABLE "session" (id text PRIMARY KEY,"userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
token text NOT NULL UNIQUE,"expiresAt" timestamptz NOT NULL,"createdAt" timestamptz NOT NULL DEFAULT now(),"updatedAt" timestamptz NOT NULL DEFAULT now());`;

async function fixture(run) {
  const admin = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const schema = `account_test_${randomUUID().replaceAll('-', '')}`;
  const setup = await admin.connect();
  try {
    await setup.query('SELECT pg_advisory_lock(87361829)');
    try { await setup.query('CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public'); }
    finally { await setup.query('SELECT pg_advisory_unlock(87361829)'); }
  } finally { setup.release(); }
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 5, options: `-c search_path=${schema},public` });
  try {
    await pool.query(await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8'));
    await pool.query(authSchema);
    await pool.query(await readFile(new URL('../db/event-schema.sql', import.meta.url), 'utf8'));
    await pool.query(await readFile(new URL('../db/retreat-schema.sql', import.meta.url), 'utf8'));
    await pool.query(await readFile(new URL('../db/account-schema.sql', import.meta.url), 'utf8'));
    const createUser = async (id, provider, fields = {}) => {
      await pool.query('INSERT INTO "user" (id,name,email) VALUES ($1,$1,$2)', [id, `${id}@test.invalid`]);
      await pool.query(`INSERT INTO app_users (user_id,name,role,is_member_verified,member_verification_revoked_at,peer_group,gender,phone_number)
        VALUES ($1,$1,$2,$3,$4,$5,$6,$7)`,
        [id, fields.role ?? 'user', fields.isMemberVerified ?? false, fields.revokedAt ?? null,
          fields.peerGroup ?? null, fields.gender ?? null, fields.phoneNumber ?? null]);
      await pool.query('INSERT INTO "account" (id,"userId","providerId","accountId") VALUES ($1,$2,$3,$4)', [`account-${id}`, id, provider, `subject-${id}`]);
      await pool.query(`INSERT INTO "session" (id,"userId",token,"expiresAt","authVersion","authProviderId")
        VALUES ($1,$2,$1,now()+interval '1 hour',1,$3)`, [`session-${id}`, id, provider]);
      if (fields.role === 'admin') await pool.query('INSERT INTO admin_users (user_id) VALUES ($1)', [id]);
      return { userId: id, sessionId: `session-${id}`, authVersion: 1, role: fields.role ?? 'user', name: id,
        isMemberVerified: fields.isMemberVerified ?? false, memberVerificationRevokedAt: fields.revokedAt ?? null,
        status: 'active', mergedIntoUserId: null, version: 2, sessionCreatedAt: new Date().toISOString() };
    };
    const createEvent = async (title = 'Event') => (await pool.query(`INSERT INTO events (title,starts_at,ends_at,publication_status)
      VALUES ($1,now()+interval '1 day',now()+interval '2 days','published') RETURNING id`, [title])).rows[0].id;
    const register = async (userId, eventId, fields = {}) => (await pool.query(`INSERT INTO registrations
      (user_id,event_id,participant_name,status,attendance_status,retreat_answers) VALUES ($1,$2,$5,$3,$4,$6::jsonb) RETURNING *`,
    [userId, eventId, fields.status ?? 'confirmed', fields.attendance ?? 'unmarked', fields.name ?? '동일 참가자',
      fields.answers == null ? null : JSON.stringify(fields.answers)])).rows[0];
    const readyMerge = async (owner, source) => {
      const { operation, token } = await prepareOperation(pool, owner, 'merge', randomUUID(), secret, 'kakao');
      await proveMerge(pool, operation.id, token, source);
      const preview = await previewMerge(pool, operation.id, token, owner);
      return { id: operation.id, token, preview };
    };
    await run({ pool, createUser, createEvent, register, readyMerge });
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
}

test('PostgreSQL: atomic merge preserves confirmed attendance, membership revocation and idempotent result', { skip: !databaseUrl }, async () => fixture(async ({ pool, createUser, createEvent, register, readyMerge }) => {
  const owner = await createUser('owner', 'google', { isMemberVerified: true, peerGroup: '98', phoneNumber: '01011112222' });
  const source = await createUser('source', 'kakao', { revokedAt: '2026-10-01', peerGroup: '99', gender: 'female', phoneNumber: '01033334444' });
  await pool.query('UPDATE "user" SET image=$2,"emailVerified"=true WHERE id=$1', ['source', 'https://example.invalid/private-source-avatar']);
  const event = await createEvent();
  await register(owner.userId, event, { status: 'cancelled', answers: retreatAnswers({ prayerRequest: 'CANCELLED_PRIVATE_PRAYER' }) });
  const winning = await register(source.userId, event, { attendance: 'present', answers: retreatAnswers() });
  const { id, token, preview } = await readyMerge(owner, source);
  assert.equal(preview.registrationResults[0].hasRetreatAnswers, true);
  assert.doesNotMatch(JSON.stringify(preview), /PRIVATE_PRAYER|PRIVATE_RETREAT_PRAYER|01011112222|01033334444|01012345678/);
  const requestKey = randomUUID();
  const results = await Promise.all([confirmMerge(pool, id, token, owner, preview.snapshotHash, requestKey),
    confirmMerge(pool, id, token, owner, preview.snapshotHash, requestKey)]);
  assert.deepEqual(results[0], results[1]);
  assert.equal(results[0].primaryUserId, 'owner');
  const registrations = (await pool.query('SELECT * FROM registrations')).rows;
  assert.equal(registrations.length, 1); assert.equal(registrations[0].id, winning.id);
  assert.equal(registrations[0].user_id, 'owner'); assert.equal(registrations[0].attendance_status, 'present');
  assert.deepEqual(registrations[0].retreat_answers, retreatAnswers());
  const users = (await pool.query('SELECT * FROM app_users ORDER BY user_id')).rows;
  assert.equal(users[0].is_member_verified, false); assert.ok(users[0].member_verification_revoked_at);
  assert.equal(users[1].status, 'merged'); assert.equal(users[1].merged_into_user_id, 'owner');
  assert.equal(users[0].peer_group, '98'); assert.equal(users[0].gender, 'female'); assert.equal(users[0].phone_number, '01011112222');
  assert.equal(users[1].peer_group, null); assert.equal(users[1].gender, null); assert.equal(users[1].phone_number, null);
  const audit = (await pool.query('SELECT data FROM auth_account_operations WHERE id=$1', [id])).rows[0].data.audit;
  assert.doesNotMatch(JSON.stringify(audit), /PRIVATE_PRAYER|PRIVATE_RETREAT_PRAYER|01011112222|01033334444|01012345678|retreat_answers|phone_number|peer_group/);
  assert.deepEqual((await pool.query('SELECT DISTINCT "userId" FROM "account"')).rows, [{ userId: 'owner' }]);
  assert.equal((await pool.query('SELECT * FROM "session"')).rowCount, 0);
  const sourceIdentity = (await pool.query('SELECT name,email,image,"emailVerified" FROM "user" WHERE id=$1', ['source'])).rows[0];
  assert.equal(sourceIdentity.name, '통합된 사용자');
  assert.match(sourceIdentity.email, /@merged\.invalid$/);
  assert.equal(sourceIdentity.image, null);
  assert.equal(sourceIdentity.emailVerified, false);
  const targetIdentity = (await pool.query('SELECT name,email FROM "user" WHERE id=$1', ['owner'])).rows[0];
  assert.deepEqual(targetIdentity, { name: 'owner', email: 'owner@test.invalid' });
  await assert.rejects(() => confirmMerge(pool, id, token, null, preview.snapshotHash, randomUUID()), { code: 'IDEMPOTENCY_CONFLICT' });
}));

test('PostgreSQL: whole-set preview validation rejects newly added registration without partial merge', { skip: !databaseUrl }, async () => fixture(async ({ pool, createUser, createEvent, register, readyMerge }) => {
  const owner = await createUser('owner', 'google'); const source = await createUser('source', 'kakao');
  const { id, token, preview } = await readyMerge(owner, source);
  await register('source', await createEvent('Added after preview'));
  await assert.rejects(() => confirmMerge(pool, id, token, owner, preview.snapshotHash, randomUUID()), { code: 'PREVIEW_STALE' });
  assert.equal((await pool.query("SELECT * FROM app_users WHERE status='active'")).rowCount, 2);
  assert.equal((await pool.query('SELECT * FROM "session"')).rowCount, 2);
}));

test('PostgreSQL: explicit attendance conflict cannot commit', { skip: !databaseUrl }, async () => fixture(async ({ pool, createUser, createEvent, register, readyMerge }) => {
  const owner = await createUser('owner', 'google'); const source = await createUser('source', 'kakao'); const event = await createEvent();
  await register('owner', event, { attendance: 'present' }); await register('source', event, { attendance: 'absent' });
  const { id, token, preview } = await readyMerge(owner, source);
  assert.equal(preview.conflicts[0].code, 'ATTENDANCE_CONFLICT');
  await assert.rejects(() => confirmMerge(pool, id, token, owner, preview.snapshotHash, randomUUID()), { code: 'ATTENDANCE_CONFLICT' });
  assert.equal((await pool.query('SELECT * FROM registrations')).rowCount, 2);
}));

test('PostgreSQL: conflicting confirmed retreat answers block without leaking or dropping either answer', { skip: !databaseUrl }, async () => fixture(async ({ pool, createUser, createEvent, register, readyMerge }) => {
  const owner = await createUser('owner', 'google'); const source = await createUser('source', 'kakao'); const event = await createEvent();
  const first = retreatAnswers({ prayerRequest: 'FIRST_PRIVATE_PRAYER' });
  const second = retreatAnswers({ prayerRequest: 'SECOND_PRIVATE_PRAYER', departureOption: 'late' });
  await register('owner', event, { answers: first }); await register('source', event, { answers: second });
  const { id, token, preview } = await readyMerge(owner, source);
  assert.ok(preview.conflicts.some((conflict) => conflict.code === 'REGISTRATION_ANSWERS_CONFLICT'));
  assert.doesNotMatch(JSON.stringify(preview), /FIRST_PRIVATE_PRAYER|SECOND_PRIVATE_PRAYER|01012345678/);
  await assert.rejects(() => confirmMerge(pool, id, token, owner, preview.snapshotHash, randomUUID()), { code: 'REGISTRATION_ANSWERS_CONFLICT' });
  const registrations = (await pool.query('SELECT user_id,retreat_answers FROM registrations ORDER BY user_id')).rows;
  assert.deepEqual(registrations, [{ user_id: 'owner', retreat_answers: first }, { user_id: 'source', retreat_answers: second }]);
  assert.equal((await pool.query("SELECT * FROM app_users WHERE status='active'")).rowCount, 2);
}));

test('PostgreSQL: changing retreat answers or profile values after preview invalidates confirmation even without a version increment', { skip: !databaseUrl }, async () => fixture(async ({ pool, createUser, createEvent, register, readyMerge }) => {
  const owner = await createUser('owner', 'google'); const source = await createUser('source', 'kakao'); const event = await createEvent();
  await register('source', event, { answers: retreatAnswers() });
  const { id, token, preview } = await readyMerge(owner, source);
  await pool.query('UPDATE registrations SET retreat_answers=$1::jsonb WHERE user_id=$2',
    [JSON.stringify(retreatAnswers({ prayerRequest: 'EDITED_PRIVATE_PRAYER' })), 'source']);
  await assert.rejects(() => confirmMerge(pool, id, token, owner, preview.snapshotHash, randomUUID()), { code: 'PREVIEW_STALE' });
  const updated = await previewMerge(pool, id, token, owner);
  await pool.query('UPDATE app_users SET phone_number=$2 WHERE user_id=$1', ['owner', '01099998888']);
  await assert.rejects(() => confirmMerge(pool, id, token, owner, updated.snapshotHash, randomUUID()), { code: 'PREVIEW_STALE' });
  assert.equal((await pool.query("SELECT * FROM app_users WHERE status='active' AND auth_version=1")).rowCount, 2);
}));

test('PostgreSQL: any late database failure rolls back account movement and deleted duplicate registrations', { skip: !databaseUrl }, async () => fixture(async ({ pool, createUser, createEvent, register, readyMerge }) => {
  const owner = await createUser('owner', 'google'); const source = await createUser('source', 'kakao'); const event = await createEvent();
  await register('owner', event); await register('source', event);
  const { id, token, preview } = await readyMerge(owner, source);
  await pool.query(`CREATE FUNCTION fail_completed() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.status='completed' THEN RAISE EXCEPTION 'injected failure'; END IF; RETURN NEW; END; $$;
    CREATE TRIGGER fail_merge_completed BEFORE UPDATE ON auth_account_operations FOR EACH ROW EXECUTE FUNCTION fail_completed();`);
  await assert.rejects(() => confirmMerge(pool, id, token, owner, preview.snapshotHash, randomUUID()), /injected failure/);
  assert.equal((await pool.query('SELECT * FROM registrations')).rowCount, 2);
  assert.deepEqual((await pool.query('SELECT "userId" FROM "account" ORDER BY "userId"')).rows, [{ userId: 'owner' }, { userId: 'source' }]);
  assert.equal((await pool.query("SELECT * FROM app_users WHERE status='active' AND auth_version=1")).rowCount, 2);
  assert.equal((await pool.query('SELECT * FROM "session"')).rowCount, 2);
}));

test('PostgreSQL: administrator ID survives and confirmation requires approval of that exact preview', { skip: !databaseUrl }, async () => fixture(async ({ pool, createUser, readyMerge }) => {
  const owner = await createUser('owner', 'google'); const source = await createUser('source', 'kakao', { role: 'admin' });
  const reviewer = await createUser('reviewer', 'google', { role: 'admin' });
  const { id, token, preview } = await readyMerge(owner, source);
  assert.equal(preview.targetUserId, 'source'); assert.equal(preview.requiresAdminApproval, true);
  await assert.rejects(() => confirmMerge(pool, id, token, owner, preview.snapshotHash, randomUUID()), { code: 'ADMIN_APPROVAL_REQUIRED' });
  await approveMerge(pool, id, preview.snapshotHash, reviewer);
  await confirmMerge(pool, id, token, owner, preview.snapshotHash, randomUUID());
  assert.equal((await pool.query("SELECT status FROM app_users WHERE user_id='owner'")).rows[0].status, 'merged');
  assert.equal((await pool.query("SELECT user_id FROM admin_users WHERE user_id='source'")).rowCount, 1);
}));

test('PostgreSQL: wrong operation token and missing/stale OAuth evidence never prove another user', { skip: !databaseUrl }, async () => fixture(async ({ pool, createUser }) => {
  const owner = await createUser('owner', 'google'); const source = await createUser('source', 'kakao');
  const { operation } = await prepareOperation(pool, owner, 'merge', randomUUID(), secret);
  await assert.rejects(() => proveMerge(pool, operation.id, '0'.repeat(64), source), { code: 'INVALID_OPERATION_PROOF' });
  await pool.query('UPDATE "session" SET "createdAt"=now()-interval \'6 minutes\' WHERE id=$1', [source.sessionId]);
  await assert.rejects(() => readRecentProof(pool, source), { code: 'RECENT_LOGIN_REQUIRED' });
  await pool.query('UPDATE "session" SET "createdAt"=now(),"authProviderId"=\'\' WHERE id=$1', [source.sessionId]);
  await assert.rejects(() => readRecentProof(pool, source), { code: 'OAUTH_PROOF_REQUIRED' });
  assert.equal((await pool.query('SELECT source_user_id FROM auth_account_operations WHERE id=$1', [operation.id])).rows[0].source_user_id, null);
}));

test('PostgreSQL: unlink requires fresh login using the remaining method and invalidates old sessions', { skip: !databaseUrl }, async () => fixture(async ({ pool, createUser }) => {
  const actor = await createUser('owner', 'google');
  await assert.rejects(() => unlinkLogin(pool, actor, 'account-owner'), { code: 'LAST_LOGIN_METHOD' });
  await pool.query('INSERT INTO "account" (id,"userId","providerId","accountId") VALUES (\'kakao-owner\',\'owner\',\'kakao\',\'kakao-subject\')');
  await assert.rejects(() => unlinkLogin(pool, actor, 'account-owner'), { code: 'REMAINING_METHOD_PROOF_REQUIRED' });
  await pool.query('UPDATE "session" SET "authProviderId"=\'kakao\' WHERE id=$1', [actor.sessionId]);
  await unlinkLogin(pool, actor, 'account-owner');
  assert.equal((await pool.query('SELECT * FROM "account"')).rows[0].providerId, 'kakao');
  assert.equal((await pool.query('SELECT * FROM "session"')).rowCount, 0);
  assert.equal((await pool.query('SELECT auth_version FROM app_users')).rows[0].auth_version, 2);
}));

test('PostgreSQL: required Kakao user and Google admin login methods cannot be unlinked', { skip: !databaseUrl }, async () => fixture(async ({ pool, createUser }) => {
  for (const [id, provider, otherProvider, role] of [
    ['participant', 'kakao', 'google', 'user'], ['administrator', 'google', 'kakao', 'admin'],
  ]) {
    const actor = await createUser(id, provider, { role });
    await pool.query('INSERT INTO "account" (id,"userId","providerId","accountId") VALUES ($1,$2,$3,$1)',
      [`other-${id}`, id, otherProvider]);
    await pool.query('UPDATE "session" SET "authProviderId"=$2 WHERE id=$1', [actor.sessionId, otherProvider]);
    await assert.rejects(() => unlinkLogin(pool, actor, `account-${id}`), { code: 'REQUIRED_LOGIN_METHOD' });
    assert.equal((await pool.query('SELECT id FROM "account" WHERE "userId"=$1', [id])).rowCount, 2);
    assert.equal((await pool.query('SELECT id FROM "session" WHERE "userId"=$1', [id])).rowCount, 1);
  }
}));

test('PostgreSQL: deletion anonymizes attendance, cancels future registrations and rejects the last admin', { skip: !databaseUrl }, async () => fixture(async ({ pool, createUser, createEvent, register }) => {
  const owner = await createUser('owner', 'google', { peerGroup: '99', gender: 'female', phoneNumber: '01012345678' });
  const future = await register('owner', await createEvent(), { answers: retreatAnswers() });
  const pastEvent = await createEvent('Past retreat');
  await pool.query("UPDATE events SET starts_at=now()-interval '2 days',ends_at=now()-interval '1 day',lifecycle_status='completed' WHERE id=$1", [pastEvent]);
  const past = await register('owner', pastEvent, { attendance: 'present', answers: retreatAnswers({ prayerRequest: 'PAST_PRIVATE_PRAYER' }) });
  const prepared = await prepareOperation(pool, owner, 'delete', randomUUID(), secret);
  const preview = await previewDeletion(pool, prepared.operation.id, prepared.token, owner);
  await confirmDeletion(pool, prepared.operation.id, prepared.token, owner, preview.snapshotHash, randomUUID());
  const registrations = (await pool.query('SELECT * FROM registrations')).rows;
  const registration = registrations.find((row) => row.id === future.id);
  assert.equal(registration.status, 'cancelled'); assert.equal(registration.participant_name, '탈퇴한 사용자');
  assert.equal(registration.retreat_answers, null);
  const historical = registrations.find((row) => row.id === past.id);
  assert.equal(historical.status, 'confirmed'); assert.equal(historical.attendance_status, 'present');
  assert.equal(historical.participant_name, '탈퇴한 사용자'); assert.equal(historical.retreat_answers, null);
  const profile = (await pool.query('SELECT peer_group,gender,phone_number FROM app_users WHERE user_id=$1', ['owner'])).rows[0];
  assert.deepEqual(profile, { peer_group: null, gender: null, phone_number: null });
  assert.equal((await pool.query('SELECT * FROM "account"')).rowCount, 0);
  assert.match((await pool.query('SELECT email FROM "user"')).rows[0].email, /@deleted\.invalid$/);
  const admin = await createUser('only-admin', 'google', { role: 'admin' });
  const adminPrepared = await prepareOperation(pool, admin, 'delete', randomUUID(), secret);
  const adminPreview = await previewDeletion(pool, adminPrepared.operation.id, adminPrepared.token, admin);
  await assert.rejects(() => confirmDeletion(pool, adminPrepared.operation.id, adminPrepared.token, admin, adminPreview.snapshotHash, randomUUID()), { code: 'LAST_ADMIN' });
}));
