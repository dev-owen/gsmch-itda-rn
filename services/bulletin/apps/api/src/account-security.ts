/** Only fixed account-screen callbacks; trusted origins are configuration, never request data. */
export function isAccountCallbackAllowed(callback: string, trustedOrigins: string[]): boolean {
  const paths = ['/account/login-methods', '/account', '/auth/callback'];
  if (paths.includes(callback)) return true;
  return trustedOrigins.some((origin) => {
    if (/^[a-z][a-z0-9+.-]*:\/\/$/i.test(origin) && !/^https?:/i.test(origin)) {
      return callback === `${origin}auth/callback` || callback === `${origin}/auth/callback`;
    }
    try {
      const base = new URL(origin);
      const destination = new URL(callback);
      return ['http:', 'https:'].includes(base.protocol) && destination.origin === base.origin
        && !destination.username && !destination.password && !destination.search && !destination.hash
        && paths.includes(destination.pathname);
    } catch { return false; }
  });
}

export function isAccountOriginAllowed(origin: string | undefined, trustedOrigins: string[], apiUrl: string): boolean {
  if (!origin) return true; // Native fetch has no browser Origin header; server sessions remain required.
  return trustedOrigins.includes(origin) || origin === new URL(apiUrl).origin;
}
