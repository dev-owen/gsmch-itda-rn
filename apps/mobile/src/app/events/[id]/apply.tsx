import { useCallback, useState } from 'react';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { api } from '@/services/api';
import { useSession } from '@/services/session';
import { useAction, useResource } from '@/hooks/use-resource';
import { useNow } from '@/hooks/use-now';
import { AccessGate } from '@/components/access-gate';
import { eventStatus, formatDate } from '@/components/event-card';
import { Body, Button, Card, DetailRow, ErrorState, Field, LoadingState, Notice, Screen } from '@/components/ui';

export default function ApplyScreen() { const { id } = useLocalSearchParams<{ id: string }>(); const { user } = useSession(); return <AccessGate returnTo={`/events/${id}/apply`}><ApplyForm key={`${id}:${user?.id}`} id={id} /></AccessGate>; }

function ApplyForm({ id }: { id: string }) {
  const { user } = useSession();
  const [name, setName] = useState<string>(user?.name || '');
  const action = useAction();
  const resource = useResource(useCallback(async () => { const [event, registrations] = await Promise.all([api.getEvent(id), api.listMyRegistrations()]); return { event, registration: registrations.find(item => item.eventId === id) }; }, [id]), `${user?.id}:${user?.isMemberVerified}:${user?.role}`);
  const now = useNow();
  if (resource.loading && !resource.data) return <Screen back><LoadingState /></Screen>;
  if (resource.error || !resource.data) return <Screen title="행사 신청" back><ErrorState message={resource.error || '행사를 불러오지 못했습니다.'} onRetry={() => void resource.reload()} /></Screen>;
  const { event, registration } = resource.data;
  if (event.retreatSlug) return <Redirect href="/retreats/nehemiah-winter/apply" />;
  const status = eventStatus(event, now);
  if (registration?.status === 'confirmed') return <Screen title="이미 신청한 행사예요" back><Button label="내 신청 확인하기" onPress={() => router.replace({ pathname: '/registrations/[id]', params: { id: registration.id } })} /></Screen>;
  const verified = !event.requiresMemberVerification || !!user?.isMemberVerified;
  const submit = () => void action.run(async () => {
    if (!name.trim()) throw new Error('실제 참가 이름을 입력해 주세요.');
    const result = await api.register(id, { participantName: name.trim(), expectedEventVersion: event.version, expectedRegistrationVersion: registration?.version ?? null });
    router.replace({ pathname: '/registrations/[id]', params: { id: result.id, confirmed: '1' } });
  });
  return <Screen back eyebrow="REGISTRATION" title="함께할 이름을 알려주세요" subtitle="신청하면 바로 확정됩니다. 내용을 한 번 더 확인해 주세요.">
    <Card><Body>{event.title}</Body><DetailRow label="일정" value={formatDate(event.startsAt, event.allDay)} /><DetailRow label="장소" value={event.location} /></Card>
    <Field label="실제 참가 이름" value={name} onChangeText={setName} maxLength={50} autoComplete="name" placeholder="예: 김은혜" help="현장에서 신청자 확인에 사용할 이름이에요. 소셜 계정의 별명과 다를 수 있어요." />
    <Body muted>참가 이름과 신청·출석 정보는 행사 운영을 위해 저장됩니다. 다른 참가자에게는 공개되지 않아요.</Body>
    {!verified && <Notice>성도 인증이 필요한 행사입니다. 내 계정에서 인증을 먼저 요청해 주세요.</Notice>}
    {!status.canApply && <Notice>{status.label} 상태로 현재 신청할 수 없습니다.</Notice>}
    {action.error && <Notice danger>{action.error}</Notice>}
    <Button label="신청 확정하기" busy={action.busy} disabled={!verified || !status.canApply || !name.trim()} onPress={submit} />
    <Button label="행사 다시 확인하기" variant="ghost" onPress={() => router.back()} />
  </Screen>;
}
