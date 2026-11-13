import { createContext, useCallback, useContext, useEffect, useState, type PropsWithChildren } from 'react';
import { AppState } from 'react-native';
import type { AppUser, Provider } from '@/domain/types';
import { authClient, signInWith, signOutOf } from './auth';
import { ApiError } from './errors';
import { request } from './transport';
import { createSessionRefreshGate } from './session-refresh';

type Session = { user: AppUser | null; loading: boolean; error: string | null; refresh(): Promise<void>;
  signIn(provider: Provider, returnTo?: string): Promise<void>; signOut(): Promise<void> };
const Context = createContext<Session | null>(null);

export function SessionProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshGate] = useState(createSessionRefreshGate);
  const refresh = useCallback(() => refreshGate.run(() => request<{ user: AppUser }>('/v1/me'), {
    success: data => { setUser({ ...data.user, status: data.user.status || 'active' }); setError(null); },
    failure: reason => { setUser(null); setError(reason instanceof ApiError && reason.status === 401 ? null : (reason as Error).message); },
    settled: () => setLoading(false),
  }), [refreshGate]);
  useEffect(() => { void Promise.resolve().then(refresh); const subscription = AppState.addEventListener('change', state => { if (state === 'active') void refresh(); }); return () => { subscription.remove(); refreshGate.invalidate(); }; }, [refresh, refreshGate]);
  useEffect(() => { const off = authClient.$store.listen('$sessionSignal', () => { void refresh(); }); return off; }, [refresh]);
  const signIn = useCallback(async (provider: Provider, returnTo?: string) => {
    const epoch = refreshGate.beginAuthChange();
    try { await signInWith(provider, { returnTo }); }
    catch (reason) { if (refreshGate.finishAuthChange(epoch)) setLoading(false); throw reason; }
    if (refreshGate.finishAuthChange(epoch)) await refresh();
  }, [refresh, refreshGate]);
  const signOut = useCallback(async () => {
    const epoch = refreshGate.beginAuthChange();
    try { await signOutOf(); }
    catch (reason) { if (refreshGate.finishAuthChange(epoch)) setLoading(false); throw reason; }
    if (refreshGate.finishAuthChange(epoch)) { setUser(null); setError(null); setLoading(false); }
  }, [refreshGate]);
  return <Context.Provider value={{ user, loading, error, refresh, signIn, signOut }}>{children}</Context.Provider>;
}

export function useSession() { const session = useContext(Context); if (!session) throw new Error('SessionProvider가 필요합니다.'); return session; }
