import { useCallback, useEffect, useRef, useState } from 'react';

export function errorMessage(error: unknown): string {
  if (error instanceof TypeError) return '서버에 연결하지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요.';
  return error instanceof Error ? error.message : '정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.';
}

export function useResource<T>(loader: () => Promise<T>, scope = '') {
  const [snapshot, setSnapshot] = useState<{ loader: () => Promise<T>; scope: string; data?: T; error: string | null }>();
  const [loading, setLoading] = useState(true);
  const sequence = useRef(0);
  const reload = useCallback(async () => {
    const current = ++sequence.current;
    setLoading(true);
    try { const result = await loader(); if (current === sequence.current) setSnapshot({ loader, scope, data: result, error: null }); }
    catch (cause) { if (current === sequence.current) setSnapshot(previous => ({ loader, scope, data: previous?.loader === loader && previous.scope === scope ? previous.data : undefined, error: errorMessage(cause) })); }
    finally { if (current === sequence.current) setLoading(false); }
  }, [loader, scope]);
  const invalidate = useCallback(() => { sequence.current++; }, []);
  useEffect(() => { let active = true; void Promise.resolve().then(() => { if (active) return reload(); }); return () => { active = false; invalidate(); }; }, [reload, invalidate]);
  const current = snapshot?.loader === loader && snapshot.scope === scope;
  return { data: current ? snapshot.data : undefined, loading: loading || !current, error: current ? snapshot.error : null, reload };
}

export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const lock = useRef(false);
  const run = useCallback(async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null); setNotice(null);
    try { await action(); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { lock.current = false; setBusy(false); }
  }, []);
  return { busy, error, notice, setNotice, run };
}
