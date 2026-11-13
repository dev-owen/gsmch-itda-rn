import { useCallback, useEffect, useState } from 'react';
import { router } from 'expo-router';
import { authClient, authReturnClient, authReturnTo, waitForAuthReturn } from '@/services/auth';
import { useSession } from '@/services/session';
import { errorMessage } from '@/hooks/use-resource';
import { Body, Button, ErrorState, LoadingState, Screen } from '@/components/ui';

export function AuthReturn({ proof = false }: { proof?: boolean }) {
  const { refresh } = useSession();
  const [error, setError] = useState<string | null>(null);
  const finish = useCallback(async (cancelled: () => boolean) => {
    try {
      await waitForAuthReturn();
      const client = authReturnClient();
      const result = await client.getSession({ query: { disableCookieCache: true } });
      if (result.error || !result.data) throw new Error('로그인 확인을 완료하지 못했습니다. 원래 화면으로 돌아가 다시 시도해 주세요.');
      if (client === authClient) await refresh();
      const requested = authReturnTo();
      const destination = requested.startsWith('/') && !requested.startsWith('//') && !requested.startsWith('/auth/') ? requested : '/account';
      if (!cancelled()) router.replace(destination as never);
    } catch (cause) { if (!cancelled()) setError(errorMessage(cause)); }
  }, [refresh]);
  useEffect(() => { let cancelled = false; void Promise.resolve().then(() => { if (!cancelled) return finish(() => cancelled); }); return () => { cancelled = true; }; }, [finish]);
  return <Screen eyebrow="ACCOUNT CONFIRMATION" title={proof ? '계정을 확인하고 있어요' : '반가워요, 잠시만요'}>
    {error ? <><ErrorState message={error} /><Body muted>완료 여부를 확인하지 못했습니다. 원래 화면에서 현재 상태를 확인한 뒤 본인 확인을 다시 시작해 주세요.</Body><Button label="원래 화면으로 돌아가기" variant="ghost" onPress={() => router.replace(authReturnClient() !== authClient ? '/account/login-methods' : '/auth/sign-in')} /></> : <><LoadingState label={proof ? '인증을 마치고 원래 화면으로 돌아갑니다' : '로그인 정보를 확인하고 원래 화면으로 돌아갑니다'} />{proof && <Body muted>현재 사용 중인 계정은 바꾸지 않습니다.</Body>}</>}
  </Screen>;
}
