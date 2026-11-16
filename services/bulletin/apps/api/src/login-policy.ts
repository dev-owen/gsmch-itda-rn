import type { Bindings } from './types.js';

type LoginEnvironment = Pick<Bindings, 'WEB_ORIGIN' | 'EXTRA_TRUSTED_ORIGINS' | 'MOBILE_APP_ORIGIN' | 'BETTER_AUTH_URL'>;
export type LoginClient = 'mobile' | 'admin';
type LoginInput = {
  provider: unknown;
  callbackURL: unknown;
  errorCallbackURL?: unknown;
  newUserCallbackURL?: unknown;
  expoOrigin?: string | null;
};

export class LoginPolicyError extends Error {
  constructor(readonly status: 400 | 403,
    readonly code: 'INVALID_LOGIN_CALLBACK' | 'PLATFORM_LOGIN_PROVIDER_MISMATCH', message: string) {
    super(message);
  }
}

function mobilePath(path: string): boolean {
  return path === '/auth/callback' || path === '/auth/proof' || path === '/account' || path.startsWith('/account/');
}

function parseCallback(callback: unknown, env: LoginEnvironment): URL | null {
  if (typeof callback !== 'string' || !callback || callback !== callback.trim() || callback.startsWith('//')) return null;
  try {
    const url = new URL(callback, env.BETTER_AUTH_URL);
    return url.username || url.password || url.hash ? null : url;
  } catch { return null; }
}

/** The application callback selects the login service; it is not a device identity claim. */
export function classifyLoginCallback(callback: unknown, env: LoginEnvironment): LoginClient | null {
  const url = parseCallback(callback, env);
  if (!url) return null;
  if (url.protocol === 'http:' || url.protocol === 'https:') {
    const trusted = [env.WEB_ORIGIN, env.BETTER_AUTH_URL, ...(env.EXTRA_TRUSTED_ORIGINS || '').split(',').map(value => value.trim())];
    if (!trusted.some(value => {
      try { const base = new URL(value); return ['http:', 'https:'].includes(base.protocol) && base.origin === url.origin; }
      catch { return false; }
    })) return null;
    if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) return 'admin';
    return mobilePath(url.pathname) ? 'mobile' : null;
  }
  try {
    const native = new URL(env.MOBILE_APP_ORIGIN || 'itda://');
    if (['http:', 'https:'].includes(native.protocol) || url.protocol !== native.protocol || url.port) return null;
    if (native.host && native.host !== url.host) return null;
    // Expo supports both itda://auth/callback and itda:///auth/callback.
    const path = native.host || !url.host ? url.pathname : `/${url.host}${url.pathname}`;
    return mobilePath(path) ? 'mobile' : null;
  } catch { return null; }
}

function internalAuthErrorCallback(callback: unknown, env: LoginEnvironment): boolean {
  const url = parseCallback(callback, env);
  if (!url || url.search) return false;
  try { return url.href === new URL('/api/auth/error', env.BETTER_AUTH_URL).href; }
  catch { return false; }
}

export function assertLoginPolicy(input: LoginInput, env: LoginEnvironment): LoginClient {
  const client = classifyLoginCallback(input.callbackURL, env);
  if (!client) throw new LoginPolicyError(400, 'INVALID_LOGIN_CALLBACK', '로그인 후 돌아갈 화면이 올바르지 않습니다.');
  const provider = client === 'mobile' ? 'kakao' : 'google';
  if (input.provider !== provider) throw new LoginPolicyError(403, 'PLATFORM_LOGIN_PROVIDER_MISMATCH',
    client === 'mobile' ? '모바일 앱에서는 카카오로만 로그인할 수 있습니다.' : '관리자 웹에서는 Google로만 로그인할 수 있습니다.');
  for (const [kind, callback] of [['newUser', input.newUserCallbackURL], ['error', input.errorCallbackURL]] as const) {
    if (callback === undefined) continue;
    // Better Auth supplies this internal HTTP error page when a flow has no custom error callback.
    if (kind === 'error' && internalAuthErrorCallback(callback, env)) continue;
    const destination = classifyLoginCallback(callback, env);
    if (!destination) throw new LoginPolicyError(400, 'INVALID_LOGIN_CALLBACK', '로그인 후 돌아갈 화면이 올바르지 않습니다.');
    if (destination !== client) throw new LoginPolicyError(403, 'PLATFORM_LOGIN_PROVIDER_MISMATCH', '로그인 후 돌아갈 화면이 올바르지 않습니다.');
  }
  if (input.expoOrigin) {
    const nativeOrigin = (env.MOBILE_APP_ORIGIN || 'itda://').replace(/\/+$/, '');
    if (client !== 'mobile' || input.expoOrigin.replace(/\/+$/, '') !== nativeOrigin) {
      throw new LoginPolicyError(403, 'PLATFORM_LOGIN_PROVIDER_MISMATCH', '모바일 앱에서는 카카오로만 로그인할 수 있습니다.');
    }
  }
  return client;
}
