export const ADMIN_AUTH_REQUIRED = 'itda-admin-auth-required';
export type AdminAuthStatus = 'login' | 'google-login' | 'forbidden';

export function adminAuthStatus(error: unknown): AdminAuthStatus | null {
  if (!error || typeof error !== 'object') return null;
  const failure = error as { status?: number; code?: string };
  if (failure.status === 401) return 'login';
  if (failure.status === 403 && failure.code === 'GOOGLE_LOGIN_REQUIRED') return 'google-login';
  if (failure.status === 403 && failure.code === 'FORBIDDEN') return 'forbidden';
  return null;
}
