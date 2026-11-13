import { AppText as Text } from '@/components/app-text';
import { useCallback } from 'react';
import {  } from 'react-native';
import { router } from 'expo-router';
import type { Provider } from '@/domain/types';
import { api } from '@/services/api';
import { useSession } from '@/services/session';
import { useAction, useResource } from '@/hooks/use-resource';
import { AccessGate } from '@/components/access-gate';
import { Badge, Body, Button, Card, ErrorState, LoadingState, Notice, Row, Screen, Section, common } from '@/components/ui';

export default function LoginMethodsScreen() { return <AccessGate returnTo="/account/login-methods"><LoginMethods /></AccessGate>; }
function LoginMethods() {
  const { refresh, user } = useSession();
  const resource = useResource(useCallback(() => api.listLoginMethods(), []), user?.id);
  const action = useAction();
  const methods = resource.data || [];
  const link = (provider: Provider) => void action.run(async () => { await api.linkLoginMethod(provider); await refresh(); await resource.reload(); action.setNotice('로그인 수단을 연결했습니다. 어느 계정으로든 같은 신청 내역을 볼 수 있어요.'); });
  const unlink = (id: string) => void action.run(async () => { const keep = methods.find(item => item.id !== id && (item.provider === 'kakao' || item.provider === 'google')); if (!keep) throw new Error('마지막 로그인 수단은 해제할 수 없습니다.'); await api.unlinkLoginMethod(id, keep.provider as Provider); await refresh(); await resource.reload(); action.setNotice('로그인 수단 연결을 해제했습니다.'); });
  const merge = (provider: Provider) => void action.run(async () => { const preview = await api.prepareMerge(provider); router.push({ pathname: '/account/merge', params: { requestId: preview.requestId } }); });
  return <Screen back eyebrow="CONNECTED ACCOUNTS" title="로그인 수단" subtitle="Google과 카카오를 하나의 계정에 연결해요.">
    <Notice>연결을 추가하거나 해제할 때 계정 소유를 다시 확인합니다. 마지막 로그인 수단은 유지해야 해요.</Notice>
    {resource.loading && !resource.data ? <LoadingState /> : resource.error ? <ErrorState message={resource.error} onRetry={() => void resource.reload()} /> : <Section title="현재 연결"><>{(['kakao', 'google'] as Provider[]).map(provider => { const method = methods.find(item => item.provider === provider); return <Card key={provider}><Row between><Text style={common.title}>{provider === 'kakao' ? '카카오' : 'Google'}</Text><Badge label={method ? '연결됨' : '연결 안 됨'} tone={method ? 'green' : 'muted'} /></Row>{method?.accountLabel && <Body muted>{method.accountLabel}</Body>}{method ? <Button label="연결 해제" variant="ghost" busy={action.busy} disabled={!method.canUnlink || methods.length < 2} onPress={() => unlink(method.id)} /> : <Button label={`${provider === 'kakao' ? '카카오' : 'Google'} 연결 추가`} variant={provider === 'kakao' ? 'kakao' : 'secondary'} busy={action.busy} onPress={() => link(provider)} />}</Card>; })}</></Section>}
    {action.error && <Notice danger>{action.error}</Notice>}{action.notice && <Notice>{action.notice}</Notice>}
    <Section title="따로 가입한 계정이 있나요?"><Card><Body>양쪽 계정을 확인한 뒤 신청 내역과 로그인 수단을 하나로 합칠 수 있어요. 확인을 마치기 전에는 다른 계정의 정보가 표시되지 않습니다.</Body><Button label="카카오로 가입한 계정 확인" variant="ghost" busy={action.busy} onPress={() => merge('kakao')} /><Button label="Google로 가입한 계정 확인" variant="ghost" busy={action.busy} onPress={() => merge('google')} /></Card></Section>
  </Screen>;
}
