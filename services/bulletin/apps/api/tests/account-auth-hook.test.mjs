import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import pg from 'pg';
import { createAuth } from '../.test-dist/auth.js';

globalThis.crypto ??= webcrypto;
const env = { WEB_ORIGIN: 'https://church.example', BETTER_AUTH_URL: 'https://api.church.example',
  BETTER_AUTH_SECRET: 'test-only-not-a-real-credential-aaaaaaaaaaaaaaaaa', GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', MOBILE_APP_ORIGIN: 'itda://', ADMIN_REGISTRATION_MODE: 'approval' };

async function withHook(row, run, overrides = {}) {
  const pool = new pg.Pool({ connectionString: 'postgresql://unused@127.0.0.1/unused' });
  const queries = [];
  pool.query = async (sql, values) => { queries.push({ sql, values }); return { rows: row ? [row] : [] }; };
  try {
    const auth = createAuth({ ...env, ...overrides }, pool);
    // This unit test exercises the installed hook, not a live database schema.
    auth.options.advanced = { ...auth.options.advanced, database: { ...auth.options.advanced?.database, validateSchema: false } };
    const hook = auth.options.databaseHooks.session.create.before;
    assert.equal(typeof hook, 'function');
    await run(hook, queries);
  } finally { await pool.end(); }
}

test('actual Better Auth session-create hook stamps Google/Kakao callback identity and database auth version', async () =>
  withHook({ auth_version: 7, status: 'active' }, async (hook, queries) => {
    const input = { id: 'session-id', userId: 'verified-user', authVersion: 999, authProviderId: 'untrusted' };
    const google = await hook(input, { path: '/callback/google' });
    assert.equal(google.data.authProviderId, 'google'); assert.equal(google.data.authVersion, 7);
    const kakao = await hook(input, { path: '/callback/:id', request: new Request('https://api.church.example/api/auth/callback/kakao?code=redacted') });
    assert.equal(kakao.data.authProviderId, 'kakao'); assert.equal(kakao.data.authVersion, 7);
    assert.deepEqual(queries.map((query) => query.values), [['verified-user'], ['verified-user']]);
  }));

test('session-create hook accepts validated social endpoint provider but never unrelated request body claims', async () =>
  withHook({ auth_version: 3, status: 'active' }, async (hook) => {
    const input = { userId: 'verified-user', authVersion: 999, authProviderId: 'google' };
    const direct = await hook(input, { path: '/sign-in/social', body: { provider: 'kakao', userId: 'attacker', authVersion: 999 } });
    assert.equal(direct.data.authProviderId, 'kakao'); assert.equal(direct.data.authVersion, 3);
    const unrelated = await hook(input, { path: '/get-session', body: { provider: 'google' } });
    assert.equal(unrelated.data.authProviderId, '');
    const unknown = await hook(input, { path: '/sign-in/social', body: { provider: 'unknown' } });
    assert.equal(unknown.data.authProviderId, '');
  }));

test('session-create hook rejects merged/deleting users and starts new app users at version one', async () => {
  for (const status of ['merged', 'deleting']) await withHook({ auth_version: 4, status }, async (hook) =>
    assert.equal(await hook({ userId: 'inactive' }, { path: '/callback/google' }), false));
  await withHook(null, async (hook) => {
    const result = await hook({ userId: 'new-user' }, { path: '/callback/kakao' });
    assert.equal(result.data.authVersion, 1); assert.equal(result.data.authProviderId, 'kakao');
  });
});

test('automatic registration runs inside the verified Google session-create hook only', async () =>
  withHook({ auth_version: 7, status: 'active' }, async (hook, queries) => {
    const input = { userId: 'verified-user', authVersion: 999, authProviderId: 'google' };
    const google = await hook(input, { path: '/callback/google' });
    assert.equal(google.data.authVersion, 7);
    assert.equal(google.data.authProviderId, 'google');
    assert.equal(queries.length, 2);
    assert.match(queries[1].sql, /INSERT INTO app_users/);
    assert.match(queries[1].sql, /INSERT INTO admin_users/);
    assert.deepEqual(queries[1].values, ['verified-user', 7]);
    await hook(input, { path: '/callback/kakao' });
    await hook(input, { path: '/get-session', body: { provider: 'google' } });
    assert.equal(queries.length, 4);
  }, { ADMIN_REGISTRATION_MODE: 'automatic' }));
