import { createAuthClient } from 'better-auth/react';
import { expoClient } from '@better-auth/expo/client';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';
import type { Provider } from '@/domain/types';
import { API_ORIGIN, APP_SCHEME } from './config';
import { ApiError } from './errors';
import { secureStorage } from './secure-storage';

let pendingReturnTo = '/account';
export function authReturnTo() { return pendingReturnTo; }
let pendingAccountFlow: Promise<unknown> | null = null;
let pendingSignIn: Promise<unknown> | null = null;
let returnClient: AuthClient;
export function authReturnClient() { return returnClient || authClient; }
export async function waitForAuthReturn() { await (pendingAccountFlow || pendingSignIn); }
export function runAccountFlow<T>(work: () => Promise<T>): Promise<T> {
  const task = Promise.resolve().then(work);
  pendingAccountFlow = task;
  void task.finally(() => { if (pendingAccountFlow === task) pendingAccountFlow = null; }).catch(() => {});
  return task;
}
const callback = (proof = false) => Linking.createURL(proof ? '/auth/proof' : '/auth/callback', { scheme: APP_SCHEME });

// Keep the Expo plugin's OAuth callback/cookie handling, while routing sensitive
// linking through the server endpoint that verifies a fresh session.
const protectedAuthFetch: typeof fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.origin === new URL(API_ORIGIN).origin && url.pathname === '/api/auth/link-social') {
    url.pathname = '/v1/me/login-methods/link';
    return fetch(url, init);
  }
  return fetch(input, init);
};

function client(prefix: string) {
  return createAuthClient({
    baseURL: API_ORIGIN,
    fetchOptions: { credentials: 'include', customFetchImpl: protectedAuthFetch },
    plugins: [expoClient({ scheme: APP_SCHEME, storagePrefix: prefix, storage: secureStorage,
      disableCache: true, webBrowserOptions: { preferEphemeralSession: true } })],
  });
}

export const authClient = client('itda-primary');
export const proofAuthClient = client('itda-proof');
export const reauthClient = client('itda-reauth');
export type AuthClient = typeof authClient;

export async function signInWith(provider: Provider, options: { proof?: boolean; returnTo?: string; client?: AuthClient } = {}) {
  pendingReturnTo = options.returnTo || '/account';
  const selected = options.client || (options.proof ? proofAuthClient : authClient);
  returnClient = selected;
  const task = completeSignIn(selected, provider, options.proof);
  pendingSignIn = task;
  try { await task; } finally { if (pendingSignIn === task) pendingSignIn = null; }
}

async function completeSignIn(selected: AuthClient, provider: Provider, proof?: boolean) {
  const before = Platform.OS !== 'web' ? (await selected.getSession({ query: { disableCookieCache: true } })).data?.session.id : null;
  const result = await selected.signIn.social({ provider, callbackURL: callback(proof),
    ...(provider === 'google' ? { additionalParams: { prompt: 'select_account' } } : {}) });
  if (result.error) throw new ApiError(result.error.code || 'SIGN_IN_FAILED', result.error.message || '로그인을 완료하지 못했습니다.');
  if (Platform.OS !== 'web') {
    const session = await selected.getSession({ query: { disableCookieCache: true } });
    if (!session.data || session.data.session.id === before) throw new ApiError('SIGN_IN_CANCELLED', '로그인이 취소되었거나 완료되지 않았습니다.');
  }
}

export async function signOutOf(clientToClear: AuthClient = authClient) {
  const result = await clientToClear.signOut();
  if (result.error && result.error.status !== 401) throw new ApiError('SIGN_OUT_FAILED', '로그아웃을 완료하지 못했습니다. 다시 시도해 주세요.');
}

export function requireNativeAccountFlow() {
  if (Platform.OS === 'web') throw new ApiError('MOBILE_FLOW_REQUIRED', '로그인 수단 연결과 계정 통합은 모바일 앱에서 진행해 주세요.');
}
