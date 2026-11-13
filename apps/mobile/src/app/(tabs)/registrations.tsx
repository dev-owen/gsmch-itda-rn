import { AppText as Text } from '@/components/app-text';
import { useCallback, useState } from 'react';
import { Pressable } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { api } from '@/services/api';
import { useSession } from '@/services/session';
import { useResource } from '@/hooks/use-resource';
import { useNow } from '@/hooks/use-now';
import { AccessGate } from '@/components/access-gate';
import { formatDate } from '@/components/event-card';
import { Badge, Body, Button, Card, Chip, EmptyState, ErrorState, LoadingState, Row, Screen, common } from '@/components/ui';

export default function RegistrationsScreen() { return <AccessGate returnTo="/registrations"><MyRegistrations /></AccessGate>; }
function MyRegistrations() {
  const { user } = useSession();
  const resource = useResource(useCallback(() => api.listMyRegistrations(), []), user?.id);
  const { reload } = resource;
  const now = useNow();
  const [filter, setFilter] = useState<'active' | 'all'>('active');
  useFocusEffect(useCallback(() => { void reload(); }, [reload]));
  const items = (resource.data || []).filter(item => filter === 'all' || (item.status === 'confirmed' && item.event?.lifecycleStatus !== 'completed' && item.event?.lifecycleStatus !== 'cancelled' && !(item.event?.endsAt && new Date(item.event.endsAt).getTime() < now)));
  return <Screen eyebrow="MY JOURNEY" title="내 신청" subtitle="함께하기로 한 만남을 확인해 보세요." refreshing={resource.loading && !!resource.data} onRefresh={() => void resource.reload()}>
    <Row><Chip label="참여 예정" selected={filter === 'active'} onPress={() => setFilter('active')} /><Chip label="전체 내역" selected={filter === 'all'} onPress={() => setFilter('all')} /></Row>
    {resource.loading && !resource.data ? <LoadingState /> : resource.error ? <ErrorState message={resource.error} onRetry={() => void resource.reload()} /> : items.length ? items.map(item => <Pressable key={item.id} accessibilityRole="button" onPress={() => router.push({ pathname: '/registrations/[id]', params: { id: item.id } })}><Card><Row between><Badge label={item.event?.lifecycleStatus === 'cancelled' ? '행사 취소' : item.status === 'cancelled' ? '신청 취소' : '신청 확정'} tone={item.status === 'cancelled' || item.event?.lifecycleStatus === 'cancelled' ? 'muted' : 'green'} /><Text style={common.caption}>{item.confirmationCode}</Text></Row><Text style={common.title}>{item.event?.title || '행사 정보 확인 중'}</Text><Body muted>{formatDate(item.event?.startsAt, item.event?.allDay)}</Body><Row between><Body>{item.participantName} 님</Body>{item.attendanceStatus === 'present' && <Badge label="출석 확인" />}</Row></Card></Pressable>) : <EmptyState title={filter === 'all' ? '아직 신청 내역이 없어요' : '다음 만남을 찾아볼까요?'} description="참여하고 싶은 행사에 신청하면 이곳에 모아드려요." action={<Button label="행사 둘러보기" variant="secondary" onPress={() => router.push('/events')} />} />}
  </Screen>;
}
