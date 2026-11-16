import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHmac, randomUUID } from 'node:crypto';
import pg from 'pg';
import { app } from '../.test-dist/index.js';

const databaseUrl = process.env.EVENT_TEST_DATABASE_URL;
const secret = 'isolated-admin-tests-only-session-signing-secret';
const answers = { peerGroup: '96또래', gender: 'female', phoneNumber: '01012345678', departureOption: 'main', departureNote: null, prayerRequest: 'PRIVATE_PRAYER' };
const authSchema = `
CREATE TABLE "user" (id text PRIMARY KEY,name text NOT NULL,email text NOT NULL UNIQUE,"emailVerified" boolean NOT NULL DEFAULT false,
  image text,"createdAt" timestamptz NOT NULL DEFAULT now(),"updatedAt" timestamptz NOT NULL DEFAULT now());
CREATE TABLE account (id text PRIMARY KEY,"userId" text NOT NULL REFERENCES "user"(id),"providerId" text NOT NULL,"accountId" text NOT NULL,
  "accessToken" text,"refreshToken" text,"idToken" text,"accessTokenExpiresAt" timestamptz,"refreshTokenExpiresAt" timestamptz,scope text,password text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),"updatedAt" timestamptz NOT NULL DEFAULT now());
CREATE TABLE session (id text PRIMARY KEY,"userId" text NOT NULL REFERENCES "user"(id),token text NOT NULL UNIQUE,"expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),"updatedAt" timestamptz NOT NULL DEFAULT now(),"ipAddress" text,"userAgent" text);
CREATE TABLE verification (id text PRIMARY KEY,identifier text NOT NULL,value text NOT NULL,"expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),"updatedAt" timestamptz NOT NULL DEFAULT now());`;

async function fixture(run) {
  const setup = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const connection = await setup.connect();
  try {
    await connection.query('SELECT pg_advisory_lock(87361829)');
    try { await connection.query('CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public'); }
    finally { await connection.query('SELECT pg_advisory_unlock(87361829)'); }
  } finally { connection.release(); }
  const schema = `admin_test_${randomUUID().replaceAll('-', '')}`;
  await setup.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(databaseUrl);
  url.searchParams.set('options', `-c search_path=${schema},public`);
  const pool = new pg.Pool({ connectionString: url.href, max: 6 });
  try {
    await pool.query(authSchema);
    for (const file of ['schema.sql', 'event-schema.sql', 'account-schema.sql', 'event-sync-schema.sql', 'retreat-schema.sql']) {
      await pool.query(await readFile(new URL(`../db/${file}`, import.meta.url), 'utf8'));
    }
    for (const [id, name, role, verified, pending, phone] of [
      ['admin', '관리자', 'admin', true, false, null],
      ['member-a', '테스트회원 가', 'user', false, true, '01012345678'],
      ['member-b', '테스트회원 나', 'user', true, false, '01098765432'],
      ['member-c', '테스트회원 다', 'user', false, false, null],
    ]) {
      await pool.query('INSERT INTO "user"(id,name,email) VALUES ($1,$2,$3)', [id, name, `${id}@test.invalid`]);
      await pool.query(`INSERT INTO app_users(user_id,name,role,is_member_verified,verification_requested_at,phone_number)
        VALUES ($1,$2,$3,$4,CASE WHEN $5 THEN now() ELSE NULL END,$6)`, [id, name, role, verified, pending, phone]);
      await pool.query(`INSERT INTO account(id,"userId","providerId","accountId","accessToken","refreshToken")
        VALUES ($1,$2,'google',$1,'SECRET_ACCESS','SECRET_REFRESH')`, [`account-${id}`, id]);
      await pool.query(`INSERT INTO session(id,"userId",token,"expiresAt","authVersion","authProviderId")
        VALUES ($1,$2,$1,now()+interval '1 hour',1,'google')`, [`session-${id}`, id]);
    }
    await pool.query(`INSERT INTO account(id,"userId","providerId","accountId") VALUES ('second-method','member-a','kakao','PRIVATE_PROVIDER_SUBJECT')`);
    const event = (await pool.query(`INSERT INTO events(title,starts_at,publication_status) VALUES ('테스트 수련회',now()+interval '1 day','published') RETURNING id`)).rows[0].id;
    const registration = (await pool.query(`INSERT INTO registrations(user_id,event_id,participant_name,retreat_answers)
      VALUES ('member-a',$1,'신청 당시 이름',$2::jsonb) RETURNING id`, [event, JSON.stringify(answers)])).rows[0].id;
    const env = { DATABASE_URL: url.href, BETTER_AUTH_URL: 'http://localhost:8787', BETTER_AUTH_SECRET: secret,
      WEB_ORIGIN: 'http://localhost:5173', MOBILE_APP_ORIGIN: 'itda://', ADMIN_REGISTRATION_MODE: 'approval' };
    const request = async (path, { actor = 'admin', method = 'GET', body } = {}) => {
      const headers = { Origin: env.WEB_ORIGIN };
      if (actor) {
        const token = `session-${actor}`;
        headers.Cookie = `better-auth.session_token=${encodeURIComponent(`${token}.${createHmac('sha256', secret).update(token).digest('base64')}`)}`;
      }
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const response = await app.fetch(new Request(`http://localhost:8787/v1${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env);
      const data = await response.json();
      return { response, data };
    };
    await run({ pool, request, registration, event });
  } finally {
    await pool.end();
    await setup.query(`DROP SCHEMA ${schema} CASCADE`);
    await setup.end();
  }
}

test('admin members: real sessions protect profile and history; responses omit authentication secrets', { skip: !databaseUrl }, async () => fixture(async ({ request }) => {
  for (const path of ['/admin/users', '/admin/users/member-a', '/admin/users/member-a/registrations']) {
    assert.equal((await request(path, { actor: null })).response.status, 401);
    assert.equal((await request(path, { actor: 'member-b' })).response.status, 403);
  }
  const { response, data } = await request('/admin/users/member-a');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(data.user.providers, ['google', 'kakao']);
  assert.equal(data.user.email, 'member-a@test.invalid');
  assert.ok(data.user.createdAt);
  assert.doesNotMatch(JSON.stringify(data), /SECRET_|PRIVATE_PROVIDER|session-admin|authVersion|accessToken|refreshToken/);
  const history = await request('/admin/users/member-a/registrations?limit=1');
  assert.equal(history.data.items[0].event.title, '테스트 수련회');
  assert.equal(history.data.items[0].answers.prayerRequest, 'PRIVATE_PRAYER');
  assert.equal((await request('/admin/users/member-b/registrations')).data.items.length, 0);
}));

test('admin members: search, disjoint verification filters and cursor pagination use the full directory', { skip: !databaseUrl }, async () => fixture(async ({ request }) => {
  const first = await request('/admin/users?search=테스트회원&limit=1');
  assert.equal(first.data.items[0].id, 'member-a');
  const next = await request(`/admin/users?search=테스트회원&limit=1&cursor=${first.data.nextCursor}`);
  assert.equal(next.data.items[0].id, 'member-b');
  for (const [query, ids] of [
    ['search=010-1234-5678', ['member-a']], ['search=member-b%40test.invalid', ['member-b']],
    ['search=테스트회원&verification=pending', ['member-a']],
    ['search=테스트회원&verification=verified', ['member-b']],
    ['search=테스트회원&verification=unverified', ['member-c']],
  ]) assert.deepEqual((await request(`/admin/users?${query}`)).data.items.map(item => item.id), ids);
  assert.equal((await request('/admin/users?verification=invalid')).response.status, 422);
}));

test('admin members: profile writes validate fields, reject stale versions and preserve submitted retreat snapshots', { skip: !databaseUrl }, async () => fixture(async ({ pool, request, registration }) => {
  const path = '/admin/users/member-a/profile';
  const initialVersion = (await request('/admin/users/member-a')).data.user.version;
  assert.equal((await request(path, { actor: null, method: 'PATCH', body: { expectedVersion: 1, name: '수정' } })).response.status, 401);
  assert.equal((await request(path, { actor: 'member-b', method: 'PATCH', body: { expectedVersion: 1, name: '수정' } })).response.status, 403);
  for (const body of [{ expectedVersion: 1 }, { expectedVersion: 1, role: 'admin' }, { expectedVersion: 1, email: 'changed@test.invalid' }, { expectedVersion: 1, phoneNumber: 'invalid' }]) {
    assert.equal((await request(path, { method: 'PATCH', body })).response.status, 422);
  }
  const changed = await request(path, { method: 'PATCH', body: { expectedVersion: initialVersion, name: ' 변경 이름 ', peerGroup: '00또래', gender: 'other', phoneNumber: '010-1111-2222' } });
  assert.equal(changed.response.status, 200);
  assert.equal(changed.data.user.name, '변경 이름');
  assert.equal(changed.data.user.phoneNumber, '01011112222');
  assert.equal(changed.data.user.version, initialVersion + 1);
  assert.equal(changed.data.user.role, 'user');
  assert.equal((await request(path, { method: 'PATCH', body: { expectedVersion: initialVersion, name: '덮어쓰기' } })).response.status, 409);
  const stored = (await pool.query('SELECT participant_name,retreat_answers FROM registrations WHERE id=$1', [registration])).rows[0];
  assert.equal(stored.participant_name, '신청 당시 이름');
  assert.deepEqual(stored.retreat_answers, answers);
  const cleared = await request(path, { method: 'PATCH', body: { expectedVersion: changed.data.user.version, peerGroup: null, gender: null, phoneNumber: null } });
  assert.equal(cleared.response.status, 200);
  assert.equal(cleared.data.user.phoneNumber, null);
}));

test('admin members: concurrent edits have one winner and revoked administrators cannot write', { skip: !databaseUrl }, async () => fixture(async ({ pool, request }) => {
  const path = '/admin/users/member-a/profile';
  const initialVersion = (await request('/admin/users/member-a')).data.user.version;
  const changes = await Promise.all(['첫 수정', '둘째 수정'].map(name => request(path, { method: 'PATCH', body: { expectedVersion: initialVersion, name } })));
  assert.deepEqual(changes.map(result => result.response.status).sort(), [200, 409]);
  await pool.query("UPDATE app_users SET role='user',version=version+1 WHERE user_id='admin'");
  assert.equal((await request(path, { method: 'PATCH', body: { expectedVersion: initialVersion + 1, name: '권한 없는 수정' } })).response.status, 403);
  assert.equal((await pool.query("SELECT version FROM app_users WHERE user_id='member-a'")).rows[0].version, initialVersion + 1);
}));
