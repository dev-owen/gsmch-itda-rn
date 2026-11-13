import { AppText as Text } from '@/components/app-text';
import { useCallback, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { api } from '@/services/api';
import { useSession } from '@/services/session';
import { useAction, useResource } from '@/hooks/use-resource';
import { useNow } from '@/hooks/use-now';
import { AccessGate } from '@/components/access-gate';
import { formatDate } from '@/components/event-card';
import { Badge, Body, Button, Card, DetailRow, Divider, ErrorState, Field, LoadingState, Notice, Row, Screen, Section, common } from '@/components/ui';

export default function RegistrationScreen() { const { id, confirmed } = useLocalSearchParams<{ id: string; confirmed?: string }>(); return <AccessGate returnTo={`/registrations/${id}`}><RegistrationDetail id={id} justConfirmed={confirmed === '1'} /></AccessGate>; }
function RegistrationDetail({ id, justConfirmed }: { id: string; justConfirmed: boolean }) {
  const { user } = useSession();
  const resource = useResource(useCallback(async () => { const items = await api.listMyRegistrations(); const item = items.find(entry => entry.id === id); if (!item) throw new Error('신청 내역을 찾을 수 없습니다. 계정을 확인해 주세요.'); return item; }, [id]), user?.id);
  const action = useAction();
  const [name, setName] = useState('');
  const [editing, setEditing] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const now = useNow();
  if (resource.loading && !resource.data) return <Screen back><LoadingState /></Screen>;
  if (resource.error || !resource.data) return <Screen back title="내 신청"><ErrorState message={resource.error || '신청 정보를 확인할 수 없습니다.'} onRetry={() => void resource.reload()} /></Screen>;
  const registration = resource.data;
  const event = registration.event;
  const cancelled = registration.status === 'cancelled';
  const eventCancelled = event?.lifecycleStatus === 'cancelled';
  const canCancel = !cancelled && !eventCancelled && registration.attendanceStatus === 'unmarked' && !(event?.cancellationClosesAt && new Date(event.cancellationClosesAt).getTime() <= now);
  const saveName = () => void action.run(async () => { if (!name.trim()) throw new Error('실제 참가 이름을 입력해 주세요.'); await api.updateRegistrationName(id, name.trim(), registration.version); await resource.reload(); setEditing(false); action.setNotice('참가 이름을 수정했습니다.'); });
  const cancel = () => void action.run(async () => { await api.cancelRegistration(id, registration.version); setConfirmCancel(false); await resource.reload(); action.setNotice('신청을 취소했습니다.'); });
  return <Screen back eyebrow="MY REGISTRATION" title={event?.title || '내 신청'} onRefresh={() => void resource.reload()} refreshing={resource.loading}>
    {justConfirmed && !cancelled && !eventCancelled && <Notice>신청이 확정되었어요. 함께할 날을 기다릴게요.</Notice>}
    <Row><Badge label={eventCancelled ? '행사 취소' : cancelled ? '신청 취소' : '신청 확정'} tone={eventCancelled ? 'red' : cancelled ? 'muted' : 'green'} /><Badge label={registration.attendanceStatus === 'present' ? '출석 확인' : registration.attendanceStatus === 'absent' ? '불참 처리' : '출석 미확인'} tone="muted" /></Row>
    <Card><Text style={common.caption}>신청 확인번호</Text><Text selectable style={common.largeValue}>{registration.confirmationCode}</Text><Body muted>현장에서 이름이 같은 분이 있으면 이 번호를 함께 보여주세요.</Body><Divider /><DetailRow label="참가 이름" value={registration.participantName} /><DetailRow label="일정" value={formatDate(event?.startsAt, event?.allDay)} /><DetailRow label="장소" value={event?.location} /></Card>
    {action.notice && <Notice>{action.notice}</Notice>}{action.error && <Notice danger>{action.error}</Notice>}
    {!registration.retreatSlug && !cancelled && !eventCancelled && registration.attendanceStatus === 'unmarked' && <Section title="신청 정보"><Card>{editing ? <><Field label="실제 참가 이름" value={name} onChangeText={setName} maxLength={50} /><Button label="이름 저장" busy={action.busy} disabled={!name.trim()} onPress={saveName} /><Button label="수정 닫기" variant="ghost" disabled={action.busy} onPress={() => setEditing(false)} /></> : <Button label="참가 이름 정정하기" variant="ghost" onPress={() => { setName(registration.participantName); setEditing(true); }} />}</Card></Section>}
    {registration.retreatSlug && <Button label="수련회 신청서 확인" variant="secondary" onPress={() => router.push('/retreats/nehemiah-winter/confirmation')} />}
    {event && <Button label="행사 안내 다시 보기" variant="secondary" onPress={() => router.push({ pathname: '/events/[id]', params: { id: event.id } })} />}
    {canCancel && (confirmCancel ? <Card><Body>이 행사의 신청을 취소할까요?</Body><Body muted>접수 중인 행사라면 다시 신청할 수 있어요.</Body><Button label="신청 취소 확정" variant="danger" busy={action.busy} onPress={cancel} /><Button label="참여할게요" variant="ghost" disabled={action.busy} onPress={() => setConfirmCancel(false)} /></Card> : <Button label="신청 취소하기" variant="ghost" onPress={() => setConfirmCancel(true)} />)}
    {!cancelled && !canCancel && !eventCancelled && <Body muted>취소 마감 이후이거나 출석이 처리된 신청은 운영자에게 문의해 주세요.</Body>}
  </Screen>;
}
