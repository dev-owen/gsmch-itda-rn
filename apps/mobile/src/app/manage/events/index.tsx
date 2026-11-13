import { AppText as Text } from '@/components/app-text';
import { useCallback } from 'react';
import { Pressable } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { api } from '@/services/api';
import { useAction, useResource } from '@/hooks/use-resource';
import { AccessGate } from '@/components/access-gate';
import { categoryLabel, formatEventRange } from '@/components/event-card';
import { EventSourceBadges, EventSyncStatusCard } from '@/components/event-sync';
import { Badge, Body, Button, Card, EmptyState, ErrorState, LoadingState, Notice, Row, Screen, common } from '@/components/ui';

export default function ManageEventsScreen() { return <AccessGate admin returnTo="/manage/events"><ManageEvents /></AccessGate>; }
function ManageEvents() {
  const resource = useResource(useCallback(() => api.listAdminEvents(), []));
  const sync = useResource(useCallback(() => api.getEventSyncStatus(), []));
  const action = useAction();
  const { reload } = resource;
  const { reload: reloadSync } = sync;
  useFocusEffect(useCallback(() => { void reload(); void reloadSync(); }, [reload, reloadSync]));
  const runSync = () => void action.run(async () => {
    const result = await api.runEventSync();
    await Promise.all([reload(), reloadSync()]);
    if (result.status === 'failed') throw new Error('주보 가져오기를 완료하지 못했습니다. 최근 실행 기록을 확인해 주세요.');
    action.setNotice(result.status === 'skipped' ? '가져오기를 건너뛰었습니다. 잠시 뒤 실행 기록을 다시 확인해 주세요.' : `주보를 확인했습니다. 새 일정 ${result.created}개, 갱신 ${result.updated}개, 확인이 필요한 일정 ${result.pending}개입니다.`);
  });
  return <Screen back eyebrow="CHURCH ADMIN" title="행사 운영" subtitle="행사를 안내하고, 신청과 출석을 함께 관리해요." onRefresh={() => { void reload(); void reloadSync(); }} refreshing={resource.loading && !!resource.data}>
    <Row><Button label="새 행사 등록" compact onPress={() => router.push({ pathname: '/manage/events/[id]', params: { id: 'new' } })} /><Button label="성도 인증 관리" variant="ghost" compact onPress={() => router.push('/manage/users')} /></Row>
    <EventSyncStatusCard status={sync.data} loading={sync.loading} error={sync.error} busy={action.busy} onRun={runSync} onRefresh={() => void reloadSync()} />
    {action.notice && <Notice>{action.notice}</Notice>}{action.error && <Notice danger>{action.error}</Notice>}
    {resource.loading && !resource.data ? <LoadingState /> : resource.error ? <ErrorState message={resource.error} onRetry={() => void resource.reload()} /> : resource.data?.length ? resource.data.map(event => <Card key={event.id}><Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/manage/events/[id]', params: { id: event.id } })}><Row between><Badge label={event.publicationStatus === 'published' ? '게시 중' : event.publicationStatus === 'draft' ? '작성 중' : '비공개'} tone={event.publicationStatus === 'published' ? 'green' : 'muted'} /><Text style={common.caption}>{categoryLabel(event.category)}</Text></Row><Text style={[common.title, { marginTop: 12 }]}>{event.title}</Text><Body muted>{formatEventRange(event)}</Body></Pressable><EventSourceBadges event={event} /><Row><Button label="행사 설정" compact variant="ghost" onPress={() => router.push({ pathname: '/manage/events/[id]', params: { id: event.id } })} /><Button label="신청자 · 출석" compact variant="secondary" onPress={() => router.push({ pathname: '/manage/events/[id]/roster', params: { id: event.id } })} /></Row></Card>) : <EmptyState title="아직 등록된 행사가 없어요" description="새 행사를 등록하거나 주보에서 일정을 가져올 수 있어요." />}
  </Screen>;
}
