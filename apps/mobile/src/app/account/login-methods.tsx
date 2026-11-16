import { AppText as Text } from '@/components/app-text';
import { useCallback } from 'react';
import { router } from 'expo-router';
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
  const kakao = methods.find(item => item.provider === 'kakao');
  const google = methods.find(item => item.provider === 'google');
  const link = () => void action.run(async () => { await api.linkLoginMethod('kakao'); await refresh(); await resource.reload(); action.setNotice('카카오 연결을 확인했습니다.'); });
  const unlinkGoogle = () => void action.run(async () => { if (!google || !kakao) throw new Error('앱 로그인에 필요한 카카오 연결을 먼저 확인해 주세요.'); await api.unlinkLoginMethod(google.id, 'kakao'); await refresh(); await resource.reload(); action.setNotice('Google 연결을 해제했습니다.'); });
  const merge = () => void action.run(async () => { const preview = await api.prepareMerge('kakao'); router.push({ pathname: '/account/merge', params: { requestId: preview.requestId } }); });
  return <Screen back eyebrow="CONNECTED ACCOUNTS" title="로그인 수단" subtitle="모바일 앱에서는 카카오로 로그인해요.">
    <Notice>로그인과 계정 소유 확인은 카카오만 사용합니다. 앱 로그인에 필요한 카카오 연결은 유지해야 해요. Google 로그인은 PC 관리자 웹에서 이용해 주세요.</Notice>
    {resource.loading && !resource.data ? <LoadingState /> : resource.error ? <ErrorState message={resource.error} onRetry={() => void resource.reload()} /> : <Section title="현재 연결">
      <Card><Row between><Text style={common.title}>카카오</Text><Badge label={kakao ? '연결됨' : '연결 안 됨'} tone={kakao ? 'green' : 'muted'} /></Row>{kakao?.accountLabel && <Body muted>{kakao.accountLabel}</Body>}{kakao ? <Body muted>모바일 앱 로그인에 사용하는 계정입니다.</Body> : <Button label="카카오 연결 추가" variant="kakao" busy={action.busy} onPress={link} />}</Card>
      {google && <Card><Row between><Text style={common.title}>Google</Text><Badge label="기존 연결" tone="muted" /></Row>{google.accountLabel && <Body muted>{google.accountLabel}</Body>}<Body muted>Google 로그인은 PC 관리자 웹에서 이용할 수 있습니다.</Body>{user?.role === 'admin' ? <Body muted>관리자 로그인에 필요한 연결은 유지합니다.</Body> : <Button label="기존 Google 연결 해제" variant="ghost" busy={action.busy} disabled={!kakao || !google.canUnlink || methods.length < 2} onPress={unlinkGoogle} />}</Card>}
    </Section>}
    {action.error && <Notice danger>{action.error}</Notice>}{action.notice && <Notice>{action.notice}</Notice>}
    <Section title="따로 가입한 카카오 계정이 있나요?"><Card><Body>카카오로 양쪽 계정을 확인한 뒤 신청 내역의 통합 가능 여부를 확인할 수 있어요. 확인을 마치기 전에는 다른 계정의 정보가 표시되지 않습니다.</Body><Button label="카카오로 가입한 계정 확인" variant="ghost" busy={action.busy} onPress={merge} /></Card></Section>
  </Screen>;
}
