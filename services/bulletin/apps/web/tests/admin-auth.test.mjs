import test from 'node:test';
import assert from 'node:assert/strict';
import { adminAuthStatus } from '../src/admin-auth.ts';

test('expired or revoked admin sessions require a new login', () => {
  for (const code of ['UNAUTHENTICATED', 'SESSION_EXPIRED', 'SESSION_REVOKED']) {
    assert.equal(adminAuthStatus({ status: 401, code }), 'login');
  }
});

test('wrong provider and missing admin approval have separate recovery screens', () => {
  assert.equal(adminAuthStatus({ status: 403, code: 'GOOGLE_LOGIN_REQUIRED' }), 'google-login');
  assert.equal(adminAuthStatus({ status: 403, code: 'FORBIDDEN' }), 'forbidden');
});

test('request validation, origin errors and server failures stay in the current screen', () => {
  for (const failure of [null, undefined, new Error('offline'), { status: 403, code: 'UNTRUSTED_ORIGIN' },
    { status: 422, code: 'VALIDATION_ERROR' }, { status: 503, code: 'CONFIG_ERROR' }]) {
    assert.equal(adminAuthStatus(failure), null);
  }
});
