import { useCallback, useState } from 'react';
import { router } from 'expo-router';
import { api } from '@/services/api';
import { useSession } from '@/services/session';
import { useAction, useResource } from '@/hooks/use-resource';
import { useNow } from '@/hooks/use-now';
import { AccessGate } from '@/components/access-gate';
import { retreatSessionScope } from '@/components/retreat-draft';
import { RetreatRegistrationSummary } from '@/components/retreat-ui';
import { Body, Button, Card, EmptyState, ErrorState, LoadingState, Notice, Screen } from '@/components/ui';

export default function RetreatConfirmationScreen() { const { user } = useSession(); return <AccessGate returnTo="/retreats/nehemiah-winter/confirmation"><RetreatConfirmation key={retreatSessionScope(user)} /></AccessGate>; }
function RetreatConfirmation() {
  const { user } = useSession();
  const resource = useResource(useCallback(async () => { const [camp, registration] = await Promise.all([api.getRetreat(), api.getMyRetreatRegistration()]); return { camp, registration }; }, []), retreatSessionScope(user));
  const action = useAction();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const now = useNow();
  if (resource.loading && !resource.data) return <Screen back title="내 느동수 접수"><LoadingState label="서버에서 접수 내역을 확인하고 있어요" /></Screen>;
  if (resource.error || !resource.data) return <Screen back title="내 느동수 접수"><ErrorState message={resource.error || '접수 내역을 불러오지 못했습니다.'} onRetry={() => void resource.reload()} /></Screen>;
  const { camp, registration } = resource.data;
  if (!registration) return <Screen back title="내 느동수 접수"><EmptyState title="아직 접수 내역이 없어요" description="신청 내용을 검토하고 최종 접수를 마치면 이곳에서 확인할 수 있어요." action={<Button label="신청서 작성하기" onPress={() => router.replace('/retreats/nehemiah-winter/apply')} />} /></Screen>;
  const canCancel = registration.status === 'confirmed' && registration.attendanceStatus === 'unmarked' && camp.event.lifecycleStatus !== 'cancelled' && !(camp.event.cancellationClosesAt && new Date(camp.event.cancellationClosesAt).getTime() <= now);
  const cancel = () => void action.run(async () => { await api.cancelRegistration(registration.id, registration.version); setConfirmCancel(false); await resource.reload(); action.setNotice('신청을 취소했습니다. 접수 기간 중에는 다시 신청할 수 있어요.'); });
  return <Screen back eyebrow="MY RETREAT APPLICATION" title={registration.status === 'confirmed' ? `${camp.shortName} 접수 완료` : '취소된 신청이에요'} subtitle={registration.status === 'confirmed' ? '서버에 저장된 나의 접수 내역입니다.' : '접수 기간 중이면 다시 신청할 수 있어요.'} onRefresh={() => void resource.reload()} refreshing={resource.loading}>
    {camp.isDemo && <Notice>가상 행사 접수 내역입니다. 실제 교회 수련회 신청이 아닙니다.</Notice>}
    {camp.event.lifecycleStatus === 'cancelled' && <Notice danger>행사가 취소되었습니다. 기존 접수 내역은 확인할 수 있어요.</Notice>}
    <RetreatRegistrationSummary camp={camp} registration={registration} />
    {action.notice && <Notice>{action.notice}</Notice>}{action.error && <Notice danger>{action.error}</Notice>}
    <Button label="수련회 안내 보기" variant="secondary" onPress={() => router.push('/dongsu')} /><Button label="내 신청 목록" variant="ghost" onPress={() => router.push('/registrations')} />
    {registration.status === 'cancelled' && <Button label="신청서 다시 작성하기" onPress={() => router.replace('/retreats/nehemiah-winter/apply')} />}
    {canCancel && (confirmCancel ? <Card><Body>느동수 신청을 취소할까요?</Body><Button label="신청 취소 확정" variant="danger" busy={action.busy} onPress={cancel} /><Button label="참여할게요" variant="ghost" disabled={action.busy} onPress={() => setConfirmCancel(false)} /></Card> : <Button label="신청 취소하기" variant="ghost" onPress={() => setConfirmCancel(true)} />)}
  </Screen>;
}
