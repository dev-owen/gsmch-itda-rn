import test from 'node:test';
import assert from 'node:assert/strict';
import { assertMobileLoginProvider, MobileLoginProviderError } from '../src/services/login-policy.ts';

test('mobile account authentication accepts Kakao without invoking rejection', () => {
  assert.doesNotThrow(() => assertMobileLoginProvider('kakao'));
});

test('Google and unknown providers fail before any account authentication work can run', () => {
  for (const provider of ['google', 'apple', '', undefined, { provider: 'kakao' }]) {
    let authenticationStarted = false;
    assert.throws(() => {
      assertMobileLoginProvider(provider);
      authenticationStarted = true;
    }, error => error instanceof MobileLoginProviderError
      && error.code === 'PLATFORM_LOGIN_PROVIDER_MISMATCH' && error.status === 403);
    assert.equal(authenticationStarted, false);
  }
});
