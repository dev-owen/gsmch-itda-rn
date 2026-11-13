import { AppText as Text } from '@/components/app-text';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import type { Registration } from '@/domain/types';
import { api } from '@/services/api';
import { useAction, useResource } from '@/hooks/use-resource';
import { AccessGate } from '@/components/access-gate';
import { Badge, Body, Button, Card, Chip, DetailRow, EmptyState, ErrorState, Field, LoadingState, Notice, Row, Screen, common } from '@/components/ui';

export default function RosterScreen() { const { id } = useLocalSearchParams<{ id: string }>(); return <AccessGate admin returnTo={`/manage/events/${id}/roster`}><Roster id={id} /></AccessGate>; }
function Roster({ id }: { id: string }) {
  const resource = useResource(useCallback(async () => { const [event, registrations] = await Promise.all([api.getEvent(id), api.listRoster(id)]); return { event, registrations }; }, [id]));
  const action = useAction();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);
  const registrations = resource.data?.registrations || [];
  const confirmed = registrations.filter(item => item.status === 'confirmed');
  const items = registrations.filter(item => (filter === 'all' || (filter === 'cancelled' ? item.status === 'cancelled' : item.status === 'confirmed' && item.attendanceStatus === filter)) && `${item.participantName} ${item.confirmationCode}`.toLowerCase().includes(query.trim().toLowerCase()));
  const update = (registration: Registration, status: Registration['attendanceStatus']) => void action.run(async () => { await api.setAttendance(registration.id, status, registration.version); await resource.reload(); action.setNotice(`${registration.participantName} 님의 출석 상태를 변경했습니다.`); });
  const cancel = (registration: Registration) => void action.run(async () => { await api.cancelRegistration(registration.id, registration.version); setConfirmCancel(null); await resource.reload(); action.setNotice('신청을 취소했습니다.'); });
  return <Screen back eyebrow="ATTENDANCE" title="신청자와 출석" subtitle={resource.data?.event.title || '참가자의 이름과 확인번호를 대조해 주세요.'} onRefresh={() => void resource.reload()} refreshing={resource.loading && !!resource.data}>
    <Row><Card style={common.grow}><Text style={common.largeValue}>{resource.data ? confirmed.length : '—'}</Text><Body muted>신청 확정</Body></Card><Card style={common.grow}><Text style={common.largeValue}>{resource.data ? confirmed.filter(item => item.attendanceStatus === 'present').length : '—'}</Text><Body muted>출석 확인</Body></Card></Row>
    <Field label="이름 또는 신청 확인번호" value={query} onChangeText={setQuery} placeholder="참가자 찾기" />
    <View style={common.rowWrap}>{[{ value: 'all', label: '전체' }, { value: 'unmarked', label: '미확인' }, { value: 'present', label: '출석' }, { value: 'absent', label: '불참' }, { value: 'cancelled', label: '취소' }].map(item => <Chip key={item.value} label={item.label} selected={filter === item.value} onPress={() => setFilter(item.value)} />)}</View>
    {action.error && <Notice danger>{action.error}</Notice>}{action.notice && <Notice>{action.notice}</Notice>}
    {resource.loading && !resource.data ? <LoadingState /> : resource.error ? <ErrorState message={resource.error} onRetry={() => void resource.reload()} /> : items.length ? items.map(item => <Card key={item.id}><Row between><Text style={common.title}>{item.participantName}</Text><Badge label={item.status === 'cancelled' ? '신청 취소' : item.attendanceStatus === 'present' ? '출석' : item.attendanceStatus === 'absent' ? '불참' : '미확인'} tone={item.attendanceStatus === 'present' ? 'green' : 'muted'} /></Row><Text selectable style={common.caption}>확인번호 {item.confirmationCode}</Text>{selected === item.id ? <><Notice>본인 확인 후 출석 상태를 변경해 주세요.</Notice><RetreatAnswers registration={item} />{item.status === 'confirmed' && <View style={common.gap}><Button label="출석 처리" variant="secondary" busy={action.busy} disabled={item.attendanceStatus === 'present' || resource.data?.event.lifecycleStatus === 'cancelled'} onPress={() => update(item, 'present')} /><Row><Button label="불참 처리" compact variant="ghost" busy={action.busy} disabled={item.attendanceStatus === 'absent' || resource.data?.event.lifecycleStatus === 'cancelled'} onPress={() => update(item, 'absent')} /><Button label="미확인으로 정정" compact variant="ghost" busy={action.busy} disabled={item.attendanceStatus === 'unmarked' || resource.data?.event.lifecycleStatus === 'cancelled'} onPress={() => update(item, 'unmarked')} /></Row>{confirmCancel === item.id ? <><Body>이 참가자의 신청을 취소할까요?</Body><Button label="운영자 신청 취소 확정" variant="danger" busy={action.busy} onPress={() => cancel(item)} /><Button label="취소하지 않기" variant="ghost" onPress={() => setConfirmCancel(null)} /></> : <Button label="신청 취소 처리" variant="ghost" busy={action.busy} onPress={() => setConfirmCancel(item.id)} />}</View>}<Button label="명단 접기" compact variant="ghost" onPress={() => { setSelected(null); setConfirmCancel(null); }} /></> : <Button label="참가자 확인 · 출석 처리" variant="ghost" compact onPress={() => setSelected(item.id)} />}</Card>) : <EmptyState title="해당하는 신청자가 없어요" description="검색 조건을 바꾸거나 새로고침해 주세요." />}
  </Screen>;
}

function RetreatAnswers({ registration }: { registration: Registration }) {
  const answers = registration.answers;
  if (!answers) return null;
  const gender = { male: '남성', female: '여성', other: '기타' }[answers.gender];
  const departure = { main: '본대', late: '후발대', car: '자차', other: '기타' }[answers.departureOption];
  return <Card><Text style={common.title}>수련회 신청 정보</Text>
    <DetailRow label="또래" value={answers.peerGroup} /><DetailRow label="성별" value={gender} />
    <DetailRow label="연락처" value={answers.phoneNumber} /><DetailRow label="출발" value={departure} />
    {answers.departureNote && <DetailRow label="출발 시각" value={answers.departureNote} />}
    <Body muted>기도제목</Body><Body>{answers.prayerRequest || '작성하지 않음'}</Body>
  </Card>;
}
