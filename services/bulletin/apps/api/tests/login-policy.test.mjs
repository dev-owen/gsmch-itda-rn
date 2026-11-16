import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import pg from 'pg';
import { runWithRequestState } from '@better-auth/core/context';
import { createAuth } from '../.test-dist/auth.js';
import { assertLoginPolicy, classifyLoginCallback, LoginPolicyError } from '../.test-dist/login-policy.js';

globalThis.crypto ??= webcrypto;
const env = {
  WEB_ORIGIN: 'https://church.example', BETTER_AUTH_URL: 'https://api.church.example',
  EXTRA_TRUSTED_ORIGINS: 'https://preview.church.example', MOBILE_APP_ORIGIN: 'itda://',
  BETTER_AUTH_SECRET: 'test-only-login-channel-secret-1234567890-abcdef',
  GOOGLE_CLIENT_ID: 'test-google-client', GOOGLE_CLIENT_SECRET: 'test-google-secret',
  KAKAO_CLIENT_ID: 'test-kakao-client', KAKAO_CLIENT_SECRET: 'test-kakao-secret',
};

function rejectsPolicy(input, status, code) {
  assert.throws(() => assertLoginPolicy(input, env), error => {
    assert.ok(error instanceof LoginPolicyError);
    assert.equal(error.status, status);
    assert.equal(error.code, code);
    return true;
  });
}

test('trusted native and app-web callbacks belong to Kakao; administrator callbacks belong to Google', () => {
  for (const callbackURL of ['itda://auth/callback', 'itda:///auth/callback', 'itda://auth/proof',
    'itda://account/login-methods', '/auth/callback', '/auth/proof', '/account', '/account/login-methods',
    'https://church.example/auth/callback', 'https://preview.church.example/auth/proof']) {
    assert.equal(classifyLoginCallback(callbackURL, env), 'mobile', callbackURL);
    assert.equal(assertLoginPolicy({ provider: 'kakao', callbackURL }, env), 'mobile');
    rejectsPolicy({ provider: 'google', callbackURL }, 403, 'PLATFORM_LOGIN_PROVIDER_MISMATCH');
  }
  for (const callbackURL of ['/admin', '/admin/retreats', 'https://church.example/admin',
    'https://church.example/admin/users', 'https://preview.church.example/admin/bulletins']) {
    assert.equal(classifyLoginCallback(callbackURL, env), 'admin', callbackURL);
    assert.equal(assertLoginPolicy({ provider: 'google', callbackURL }, env), 'admin');
    rejectsPolicy({ provider: 'kakao', callbackURL }, 403, 'PLATFORM_LOGIN_PROVIDER_MISMATCH');
  }
});

test('untrusted, ambiguous and missing callbacks cannot select a login client', () => {
  for (const callbackURL of [undefined, null, '', '//evil.example/admin', 'https://evil.example/admin',
    'https://church.example.evil.example/admin', 'https://church.example@evil.example/admin',
    'https://user:password@church.example/admin', 'https://church.example/admin#native',
    'https://church.example/administrator', 'https://church.example/', 'javascript:alert(1)',
    'itda://auth/callback.evil', 'evil://auth/callback']) {
    assert.equal(classifyLoginCallback(callbackURL, env), null, String(callbackURL));
    rejectsPolicy({ provider: 'google', callbackURL }, 400, 'INVALID_LOGIN_CALLBACK');
  }
});

test('secondary OAuth destinations cannot redirect a Google session into the mobile app', () => {
  for (const field of ['errorCallbackURL', 'newUserCallbackURL']) {
    rejectsPolicy({ provider: 'google', callbackURL: 'https://church.example/admin',
      [field]: 'itda://auth/callback' }, 403, 'PLATFORM_LOGIN_PROVIDER_MISMATCH');
    rejectsPolicy({ provider: 'kakao', callbackURL: 'itda://auth/callback',
      [field]: 'https://church.example/admin' }, 403, 'PLATFORM_LOGIN_PROVIDER_MISMATCH');
    rejectsPolicy({ provider: 'google', callbackURL: 'https://church.example/admin',
      [field]: 'https://evil.example/admin' }, 400, 'INVALID_LOGIN_CALLBACK');
  }
  assert.equal(assertLoginPolicy({ provider: 'google', callbackURL: 'https://church.example/admin/users',
    errorCallbackURL: 'https://church.example/admin', newUserCallbackURL: '/admin/retreats' }, env), 'admin');
  assert.equal(assertLoginPolicy({ provider: 'kakao', callbackURL: 'itda://auth/callback',
    errorCallbackURL: 'itda://auth/callback', newUserCallbackURL: '/account' }, env), 'mobile');
  for (const [provider, callbackURL] of [['google', '/admin'], ['kakao', 'itda://auth/callback']]) {
    assert.equal(assertLoginPolicy({ provider, callbackURL,
      errorCallbackURL: 'https://api.church.example/api/auth/error' }, env), provider === 'google' ? 'admin' : 'mobile');
    rejectsPolicy({ provider, callbackURL, errorCallbackURL: 'https://api.church.example/api/auth/error?escape=1' },
      400, 'INVALID_LOGIN_CALLBACK');
    rejectsPolicy({ provider, callbackURL, newUserCallbackURL: 'https://api.church.example/api/auth/error' },
      400, 'INVALID_LOGIN_CALLBACK');
  }
});

test('native-origin hints cannot open a Google flow or override the callback client', () => {
  assert.equal(assertLoginPolicy({ provider: 'kakao', callbackURL: 'itda://auth/callback', expoOrigin: 'itda://' }, env), 'mobile');
  rejectsPolicy({ provider: 'google', callbackURL: 'https://church.example/admin', expoOrigin: 'itda://' },
    403, 'PLATFORM_LOGIN_PROVIDER_MISMATCH');
  rejectsPolicy({ provider: 'kakao', callbackURL: 'itda://auth/callback', expoOrigin: 'evil://' },
    403, 'PLATFORM_LOGIN_PROVIDER_MISMATCH');
  for (const provider of ['apple', 'unknown', undefined]) {
    rejectsPolicy({ provider, callbackURL: 'itda://auth/callback' }, 403, 'PLATFORM_LOGIN_PROVIDER_MISMATCH');
  }
});

test('actual OAuth start handler rejects mismatched providers and callback escapes before database work', async () => {
  const pool = new pg.Pool({ connectionString: 'postgres://unused@127.0.0.1:1/unused' });
  pool.query = async () => assert.fail('a rejected OAuth start must not query the database');
  pool.connect = async () => assert.fail('a rejected OAuth start must not connect to the database');
  const auth = createAuth(env, pool);
  auth.options.advanced = { ...auth.options.advanced,
    database: { ...auth.options.advanced?.database, validateSchema: false } };
  try {
    for (const input of [
      { provider: 'google', callbackURL: 'itda://auth/callback' },
      { provider: 'google', callbackURL: 'itda://auth/proof' },
      { provider: 'kakao', callbackURL: 'https://church.example/admin' },
      { provider: 'google', callbackURL: 'https://church.example/admin', newUserCallbackURL: 'itda://auth/callback' },
      { provider: 'google', callbackURL: 'https://church.example/admin', errorCallbackURL: '/auth/callback' },
      { provider: 'google', callbackURL: 'itda://auth/callback', idToken: { token: 'untrusted-token' } },
    ]) {
      const response = await auth.handler(new Request('https://api.church.example/api/auth/sign-in/social', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Origin: env.WEB_ORIGIN },
        body: JSON.stringify(input),
      }));
      assert.equal(response.status, 403, await response.clone().text());
      assert.equal((await response.json()).code, 'PLATFORM_LOGIN_PROVIDER_MISMATCH');
      assert.equal(response.headers.has('Set-Cookie'), false);
    }
  } finally { await pool.end(); }
});

test('verified identity validation checks the provider identity before a direct-token session can be issued', async () => {
  const pool = new pg.Pool({ connectionString: 'postgres://unused@127.0.0.1:1/unused' });
  pool.query = async () => assert.fail('identity policy must run before database writes');
  const auth = createAuth(env, pool);
  auth.options.advanced = { ...auth.options.advanced,
    database: { ...auth.options.advanced?.database, validateSchema: false } };
  try {
    const validate = (providerId, body) => runWithRequestState(new WeakMap(), () =>
      auth.options.user.validateUserInfo({ user: {}, source: { method: 'oauth', oauth: { providerId } } }, { body }));
    const denied = await validate('google', { provider: 'kakao', callbackURL: 'itda://auth/callback' });
    assert.equal(denied.error, 'PLATFORM_LOGIN_PROVIDER_MISMATCH');
    assert.equal(await validate('kakao', { provider: 'google', callbackURL: 'itda://auth/callback' }), undefined);
    assert.equal(await validate('google', { callbackURL: 'https://church.example/admin' }), undefined);
    assert.equal((await validate('google', { callbackURL: 'https://church.example/admin',
      newUserCallbackURL: 'itda://auth/callback' })).error, 'PLATFORM_LOGIN_PROVIDER_MISMATCH');
  } finally { await pool.end(); }
});
