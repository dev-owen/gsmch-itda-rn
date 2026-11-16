import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHmac, randomUUID, webcrypto } from 'node:crypto';
import pg from 'pg';
import { app } from '../.test-dist/index.js';

globalThis.crypto ??= webcrypto;
const databaseUrl = process.env.ACCOUNT_TEST_DATABASE_URL || process.env.EVENT_TEST_DATABASE_URL;
const secret = 'test-only-api-session-authentication-secret-89e7a1b';
const authSchema = `
CREATE TABLE "user" (id text PRIMARY KEY,name text NOT NULL,email text NOT NULL UNIQUE,
  "emailVerified" boolean NOT NULL DEFAULT false,image text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),"updatedAt" timestamptz NOT NULL DEFAULT now());
CREATE TABLE "account" (id text PRIMARY KEY,"userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "providerId" text NOT NULL,"accountId" text NOT NULL,"accessToken" text,"refreshToken" text,"idToken" text,
  "accessTokenExpiresAt" timestamptz,"refreshTokenExpiresAt" timestamptz,scope text,password text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),"updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE("providerId","accountId"));
CREATE TABLE "session" (id text PRIMARY KEY,"userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,"expiresAt" timestamptz NOT NULL,"ipAddress" text,"userAgent" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),"updatedAt" timestamptz NOT NULL DEFAULT now());
CREATE TABLE verification (id text PRIMARY KEY,identifier text NOT NULL,value text NOT NULL,
  "expiresAt" timestamptz NOT NULL,"createdAt" timestamptz NOT NULL DEFAULT now(),"updatedAt" timestamptz NOT NULL DEFAULT now());`;

function sessionCookie(token) {
  // Better Auth's signed session cookie: HMAC-SHA256 with standard base64 padding.
  const signature = createHmac('sha256', secret).update(token).digest('base64');
  return `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`;
}

async function fixture(run, envOverrides = {}) {
  const admin = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const schema = `api_auth_${randomUUID().replaceAll('-', '')}`;
  const setup = await admin.connect();
  try {
    await setup.query('SELECT pg_advisory_lock(87361829)');
    try { await setup.query('CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public'); }
    finally { await setup.query('SELECT pg_advisory_unlock(87361829)'); }
  } finally { setup.release(); }
  await admin.query(`CREATE SCHEMA ${schema}`);
  const connection = new URL(databaseUrl);
  connection.searchParams.set('options', `-c search_path=${schema},public`);
  const pool = new pg.Pool({ connectionString: connection.href, max: 3 });
  const env = {
    DATABASE_URL: connection.href, WEB_ORIGIN: 'http://localhost:5173',
    BETTER_AUTH_URL: 'http://localhost:8787', BETTER_AUTH_SECRET: secret,
    GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', MOBILE_APP_ORIGIN: 'itda://',
    ADMIN_REGISTRATION_MODE: 'approval', ...envOverrides,
  };
  try {
    await pool.query(await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8'));
    await pool.query(authSchema);
    for (const file of ['event-schema.sql', 'account-schema.sql', 'retreat-schema.sql']) {
      await pool.query(await readFile(new URL(`../db/${file}`, import.meta.url), 'utf8'));
    }
    async function user(id, provider, role = 'user') {
      const token = `token-${id}-${randomUUID()}`;
      await pool.query('INSERT INTO "user" (id,name,email) VALUES ($1,$1,$2)', [id, `${id}@test.invalid`]);
      await pool.query('INSERT INTO "account" (id,"userId","providerId","accountId") VALUES ($1,$2,$3,$2)',
        [`account-${id}`, id, provider || 'kakao']);
      await pool.query('INSERT INTO app_users (user_id,name,role) VALUES ($1,$1,$2)', [id, role]);
      if (role === 'admin') await pool.query('INSERT INTO admin_users (user_id) VALUES ($1)', [id]);
      await pool.query(`INSERT INTO "session" (id,"userId",token,"expiresAt","authVersion","authProviderId")
        VALUES ($1,$2,$3,now()+interval '1 day',1,$4)`, [`session-${id}`, id, token, provider]);
      return { id, token, cookie: sessionCookie(token) };
    }
    const request = (path, cookie, init = {}) => app.request(`http://localhost:8787${path}`, {
      ...init, headers: { ...(cookie ? { Cookie: cookie } : {}), ...init.headers },
    }, env);
    await run({ pool, user, request, env });
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
}

async function denied(response, status, code) {
  assert.equal(response.status, status, await response.clone().text());
  assert.equal((await response.json()).code, code);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
}

test('PostgreSQL OAuth starts: Google admin and Kakao app flows preserve state without issuing an unverified session', { skip: !databaseUrl }, async () => fixture(async ({ pool, request, env }) => {
  Object.assign(env, { GOOGLE_CLIENT_ID: 'test-google-client', GOOGLE_CLIENT_SECRET: 'test-google-secret',
    KAKAO_CLIENT_ID: 'test-kakao-client', KAKAO_CLIENT_SECRET: 'test-kakao-secret' });
  for (const [provider, callbackURL, authorizationHost] of [
    ['google', 'http://localhost:5173/admin', 'accounts.google.com'],
    ['kakao', 'itda://auth/callback', 'kauth.kakao.com'],
  ]) {
    const response = await request('/api/auth/sign-in/social', null, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: env.WEB_ORIGIN },
      body: JSON.stringify({ provider, callbackURL }),
    });
    assert.equal(response.status, 200, await response.clone().text());
    const authorization = new URL((await response.json()).url);
    assert.equal(authorization.hostname, authorizationHost);
    assert.ok(authorization.searchParams.get('state'));
    assert.ok(response.headers.get('Set-Cookie'));
  }
  const forged = await request('/api/auth/callback/google?code=not-a-real-code&state=not-issued');
  assert.ok(forged.status >= 300 && forged.status < 400);
  assert.equal((await pool.query('SELECT id FROM "user"')).rowCount, 0);
  assert.equal((await pool.query('SELECT id FROM "session"')).rowCount, 0);
}));

test('PostgreSQL API: verified session provider and database role protect every access surface', { skip: !databaseUrl }, async (t) => fixture(async ({ pool, user, request }) => {
  const kakao = await user('kakao-user', 'kakao');
  const kakaoAdmin = await user('kakao-admin', 'kakao', 'admin');
  const google = await user('google-user', 'google');
  const googleAdmin = await user('google-admin', 'google', 'admin');
  const legacy = await user('legacy-admin', '', 'admin');

  await t.test('Kakao users can read their profile while Google sessions use the separate account-proof endpoint', async () => {
    assert.equal((await request('/v1/me', kakao.cookie)).status, 200);
    assert.equal((await request('/v1/me/registrations', kakao.cookie)).status, 200);
    assert.equal((await request('/v1/me/retreats/nehemiah-winter/registration', kakao.cookie)).status, 200);
    for (const actor of [google, googleAdmin, legacy]) {
      await denied(await request('/v1/me', actor.cookie), 403, 'KAKAO_LOGIN_REQUIRED');
      await denied(await request('/v1/me/registrations', actor.cookie), 403, 'KAKAO_LOGIN_REQUIRED');
    }
    const proof = await request('/v1/account/session', google.cookie);
    assert.equal(proof.status, 200);
    assert.equal((await proof.json()).user.id, google.id);
  });

  await t.test('Google plus admin approval is required on root and mounted admin routes', async () => {
    for (const path of ['/v1/admin/me', '/v1/admin/users', '/v1/admin/events']) {
      for (const actor of [kakao, kakaoAdmin, legacy]) {
        await denied(await request(path, actor.cookie), 403, 'GOOGLE_LOGIN_REQUIRED');
      }
      await denied(await request(path, google.cookie), 403, 'FORBIDDEN');
      assert.equal((await request(path, googleAdmin.cookie)).status, 200, path);
    }
    await pool.query("UPDATE app_users SET role='user',version=version+1 WHERE user_id=$1", [googleAdmin.id]);
    await denied(await request('/v1/admin/me', googleAdmin.cookie), 403, 'FORBIDDEN');
  });

  await t.test('forged, expired, deleted and auth-version-revoked cookies cannot access user APIs', async () => {
    await denied(await request('/v1/me', `better-auth.session_token=${encodeURIComponent(kakao.token + '.forged')}`), 401, 'UNAUTHENTICATED');
    const expired = await user('expired', 'kakao');
    await pool.query('UPDATE "session" SET "expiresAt"=now()-interval \'1 minute\' WHERE "userId"=$1', [expired.id]);
    await denied(await request('/v1/me', expired.cookie), 401, 'UNAUTHENTICATED');
    const deleted = await user('deleted-session', 'kakao');
    await pool.query('DELETE FROM "session" WHERE "userId"=$1', [deleted.id]);
    await denied(await request('/v1/me', deleted.cookie), 401, 'UNAUTHENTICATED');
    const revoked = await user('revoked', 'kakao');
    await pool.query('UPDATE app_users SET auth_version=auth_version+1 WHERE user_id=$1', [revoked.id]);
    await denied(await request('/v1/me', revoked.cookie), 401, 'SESSION_EXPIRED');
  });

  await t.test('a Kakao session with an admin role still obeys user registration ownership and attendance locks', async () => {
    const eventId = (await pool.query("INSERT INTO events(title,publication_status) VALUES ('Ownership test','published') RETURNING id")).rows[0].id;
    const other = (await pool.query('INSERT INTO registrations(event_id,user_id,participant_name) VALUES ($1,$2,$2) RETURNING id,version',
      [eventId, kakao.id])).rows[0];
    const own = (await pool.query("INSERT INTO registrations(event_id,user_id,participant_name,attendance_status) VALUES ($1,$2,$2,'present') RETURNING id,version",
      [eventId, kakaoAdmin.id])).rows[0];
    for (const method of ['DELETE', 'PATCH']) {
      const body = (registration) => JSON.stringify({ expectedVersion: registration.version,
        ...(method === 'PATCH' ? { participantName: 'Attempted correction' } : {}) });
      await denied(await request(`/v1/me/registrations/${other.id}`, kakaoAdmin.cookie, {
        method, headers: { 'Content-Type': 'application/json' }, body: body(other),
      }), 403, 'FORBIDDEN');
      await denied(await request(`/v1/me/registrations/${own.id}`, kakaoAdmin.cookie, {
        method, headers: { 'Content-Type': 'application/json' }, body: body(own),
      }), 409, 'ATTENDANCE_LOCKED');
    }
    assert.equal((await pool.query('SELECT status FROM registrations WHERE id=$1', [other.id])).rows[0].status, 'confirmed');
  });

  await t.test('admin grants require a Google identity and atomically update existing or new app membership', async () => {
    const grantSql = (await readFile(new URL('../db/grant-admin.sql', import.meta.url), 'utf8'))
      .replaceAll(":'admin_email'", '$1');
    const target = await user('grant-existing', 'google');
    const before = (await pool.query('SELECT version FROM app_users WHERE user_id=$1', [target.id])).rows[0].version;
    assert.equal((await pool.query(grantSql, [`${target.id}@test.invalid`])).rowCount, 1);
    const granted = (await pool.query('SELECT role,version FROM app_users WHERE user_id=$1', [target.id])).rows[0];
    assert.deepEqual(granted, { role: 'admin', version: before + 1 });
    assert.equal((await pool.query('SELECT user_id FROM admin_users WHERE user_id=$1', [target.id])).rowCount, 1);
    await pool.query(grantSql, [`${target.id}@test.invalid`]);
    assert.deepEqual((await pool.query('SELECT role,version FROM app_users WHERE user_id=$1', [target.id])).rows[0], granted);
    const fresh = await user('grant-new-member', 'google');
    await pool.query('DELETE FROM app_users WHERE user_id=$1', [fresh.id]);
    assert.equal((await pool.query(grantSql, [`${fresh.id}@test.invalid`])).rowCount, 1);
    assert.equal((await pool.query('SELECT role FROM app_users WHERE user_id=$1', [fresh.id])).rows[0].role, 'admin');
    const inactive = await user('grant-inactive', 'google');
    await pool.query("UPDATE app_users SET status='deleting' WHERE user_id=$1", [inactive.id]);
    for (const id of [inactive.id, kakao.id]) {
      assert.equal((await pool.query(grantSql, [`${id}@test.invalid`])).rowCount, 0);
      assert.equal((await pool.query('SELECT user_id FROM admin_users WHERE user_id=$1', [id])).rowCount, 0);
      assert.equal((await pool.query('SELECT role FROM app_users WHERE user_id=$1', [id])).rows[0].role, 'user');
    }
  });

  await t.test('public events ignore admin role for drafts and member-only visibility', async () => {
    const draft = (await pool.query("INSERT INTO events(title,publication_status) VALUES ('Private draft','draft') RETURNING id")).rows[0].id;
    const members = (await pool.query("INSERT INTO events(title,publication_status,visibility) VALUES ('Members only','published','members') RETURNING id")).rows[0].id;
    assert.equal((await request('/v1/events')).status, 200);
    for (const actor of [kakaoAdmin, googleAdmin]) {
      assert.equal((await request(`/v1/events/${draft}`, actor.cookie)).status, 404);
      assert.equal((await request(`/v1/events/${members}`, actor.cookie)).status, 404);
    }
  });
}));

test('PostgreSQL API: automatic Google administrator registration and approval-mode transition', { skip: !databaseUrl }, async (t) => fixture(async ({ pool, user, request, env }) => {
  const google = await user('automatic-google', 'google');

  await t.test('the default mode promotes a verified Google session and persists both admin records once', async () => {
    const before = (await pool.query('SELECT version FROM app_users WHERE user_id=$1', [google.id])).rows[0].version;
    const response = await request('/v1/admin/me', google.cookie);
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal((await response.json()).userId, google.id);
    const member = (await pool.query('SELECT role,version FROM app_users WHERE user_id=$1', [google.id])).rows[0];
    assert.deepEqual(member, { role: 'admin', version: before + 1 });
    assert.equal((await pool.query('SELECT user_id FROM admin_users WHERE user_id=$1', [google.id])).rowCount, 1);
    assert.equal((await request('/v1/admin/events', google.cookie)).status, 200);
    assert.equal((await request('/v1/admin/me', google.cookie)).status, 200);
    assert.deepEqual((await pool.query('SELECT role,version FROM app_users WHERE user_id=$1', [google.id])).rows[0], member);
  });

  await t.test('explicit automatic mode initializes and promotes a Google identity without app membership', async () => {
    env.ADMIN_REGISTRATION_MODE = 'automatic';
    const fresh = await user('automatic-new-member', 'google');
    await pool.query('DELETE FROM app_users WHERE user_id=$1', [fresh.id]);
    const response = await request('/v1/admin/me', fresh.cookie);
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal((await pool.query('SELECT role FROM app_users WHERE user_id=$1', [fresh.id])).rows[0].role, 'admin');
    assert.equal((await pool.query('SELECT user_id FROM admin_users WHERE user_id=$1', [fresh.id])).rowCount, 1);
  });

  await t.test('a linked Google account does not turn a Kakao login into an administrator', async () => {
    const kakao = await user('automatic-kakao', 'kakao');
    await pool.query('INSERT INTO "account" (id,"userId","providerId","accountId") VALUES ($1,$2,\'google\',$1)',
      ['linked-google', kakao.id]);
    await denied(await request('/v1/admin/me', kakao.cookie), 403, 'GOOGLE_LOGIN_REQUIRED');
    const profile = await request('/v1/me', kakao.cookie);
    assert.equal(profile.status, 200);
    assert.equal((await profile.json()).user.role, 'user');
    assert.equal((await pool.query('SELECT user_id FROM admin_users WHERE user_id=$1', [kakao.id])).rowCount, 0);
  });

  await t.test('inactive, expired and revoked Google sessions never receive an automatic grant', async () => {
    for (const [id, change, code] of [
      ['automatic-inactive', "UPDATE app_users SET status='deleting' WHERE user_id=$1", 'ACCOUNT_UNAVAILABLE'],
      ['automatic-revoked', 'UPDATE app_users SET auth_version=auth_version+1 WHERE user_id=$1', 'SESSION_EXPIRED'],
      ['automatic-expired', 'UPDATE "session" SET "expiresAt"=now()-interval \'1 minute\' WHERE "userId"=$1', 'UNAUTHENTICATED'],
    ]) {
      const actor = await user(id, 'google');
      await pool.query(change, [actor.id]);
      await denied(await request('/v1/admin/me', actor.cookie), 401, code);
      assert.equal((await pool.query('SELECT role FROM app_users WHERE user_id=$1', [actor.id])).rows[0].role, 'user');
      assert.equal((await pool.query('SELECT user_id FROM admin_users WHERE user_id=$1', [actor.id])).rowCount, 0);
    }
  });

  await t.test('approval mode stops new grants and preserves already registered administrators', async () => {
    env.ADMIN_REGISTRATION_MODE = 'approval';
    const pending = await user('approval-pending', 'google');
    await denied(await request('/v1/admin/me', pending.cookie), 403, 'FORBIDDEN');
    assert.equal((await pool.query('SELECT role FROM app_users WHERE user_id=$1', [pending.id])).rows[0].role, 'user');
    assert.equal((await pool.query('SELECT user_id FROM admin_users WHERE user_id=$1', [pending.id])).rowCount, 0);
    assert.equal((await request('/v1/admin/me', google.cookie)).status, 200);
  });
}, { ADMIN_REGISTRATION_MODE: undefined }));
