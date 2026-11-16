import { Platform } from 'react-native';
import { authClient, type AuthClient } from './auth';
import { API_ORIGIN } from './config';
import { ApiError } from './errors';

export async function request<T>(path: string, options: RequestInit & { client?: AuthClient; timeoutMs?: number } = {}): Promise<T> {
  const { client = authClient, timeoutMs = 20_000, ...init } = options;
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body) headers.set('Content-Type', 'application/json');
  if (Platform.OS !== 'web') {
    const cookie = await client.getCookie();
    if (cookie) headers.set('Cookie', cookie);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try { response = await fetch(`${API_ORIGIN}${path}`, { ...init, credentials: 'include', headers, signal: controller.signal }); }
  catch { throw new ApiError('NETWORK_ERROR', '연결을 확인하고 다시 시도해 주세요. 처리 중 끊겼다면 내 신청에서 결과를 먼저 확인해 주세요.'); }
  finally { clearTimeout(timeout); }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    // Refresh the app identity after a rejected primary session. The identity
    // lookup itself must not notify again, or an expired cookie would loop.
    if (client === authClient && path !== '/v1/me' && (response.status === 401 || payload?.code === 'KAKAO_LOGIN_REQUIRED')) {
      authClient.$store.notify('$sessionSignal');
    }
    throw new ApiError(payload?.code || 'REQUEST_FAILED', payload?.message || '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.', response.status);
  }
  if (!payload) throw new ApiError('INVALID_RESPONSE', '응답을 확인할 수 없습니다. 다시 시도해 주세요.', response.status);
  return payload as T;
}
