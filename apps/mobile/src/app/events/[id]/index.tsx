import { AppText as Text } from '@/components/app-text';
import { useCallback } from 'react';
import { Linking, StyleSheet } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { api } from '@/services/api';
import { useSession } from '@/services/session';
import { useAction, useResource } from '@/hooks/use-resource';
import { useNow } from '@/hooks/use-now';
import { categoryLabel, eventStatus, formatDate } from '@/components/event-card';
import { Badge, Body, Button, Card, DetailRow, Divider, ErrorState, LoadingState, Notice, Row, Screen, Section } from '@/components/ui';
import { palette } from '@/theme/tokens';

export default function EventDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useSession();
  const action = useAction();
  const loggedIn = !!user;
  const now = useNow();
  const resource = useResource(useCallback(async () => {
    const [event, registrations] = await Promise.all([api.getEvent(id), loggedIn ? api.listMyRegistrations() : Promise.resolve([])]);
    return { event, registration: registrations.find(item => item.eventId === id && item.status === 'confirmed') };
  }, [id, loggedIn]), `${user?.id || 'public'}:${user?.isMemberVerified}:${user?.role}:${user?.status}`);
  const { reload } = resource;
  useFocusEffect(useCallback(() => { void reload(); }, [reload]));
  if (resource.loading && !resource.data) return <Screen back><LoadingState label="행사 정보를 불러오고 있어요" /></Screen>;
  if (resource.error || !resource.data) return <Screen title="행사 안내" back><ErrorState message={resource.error || '행사를 찾을 수 없습니다.'} onRetry={() => void resource.reload()} /></Screen>;
  const { event, registration } = resource.data;
  const status = eventStatus(event, now);
  const apply = () => {
    if (event.retreatSlug) { router.push('/retreats/nehemiah-winter/apply'); return; }
    if (registration) { router.push({ pathname: '/registrations/[id]', params: { id: registration.id } }); return; }
    if (!user) { router.push({ pathname: '/auth/sign-in', params: { returnTo: `/events/${id}/apply` } }); return; }
    if (event.requiresMemberVerification && !user.isMemberVerified) { router.push('/account'); return; }
    router.push({ pathname: '/events/[id]/apply', params: { id } });
  };
  return <Screen back eyebrow={categoryLabel(event.category)} title={event.title} refreshing={resource.loading} onRefresh={() => void resource.reload()}>
    <Row>{event.isDemo && <Badge label="가상 행사" tone="gold" />}<Badge label={status.label} tone={status.tone} />{event.requiresMemberVerification && <Badge label="성도 인증 필요" tone="gold" />}</Row>
    <Card><DetailRow label="일정" value={formatDate(event.startsAt, event.allDay)} />{event.endsAt && <DetailRow label="종료" value={formatDate(event.endsAt, event.allDay)} />}<Divider /><DetailRow label="장소" value={event.location} /><DetailRow label="대상" value={event.target} />{event.registrationEnabled && <DetailRow label="신청 마감" value={formatDate(event.registrationClosesAt)} />}</Card>
    <Section title="함께할 이야기"><Body>{event.description || '자세한 안내를 준비하고 있습니다.'}</Body></Section>
    {user ? event.memberDetails ? <Section title="참여 안내"><Card><Body>{event.memberDetails}</Body></Card></Section> : null : <Card><Text style={styles.lockTitle}>조금 더 자세한 안내</Text><Body muted>로그인하면 참여에 필요한 추가 안내를 확인할 수 있어요.</Body><Button label="로그인하고 확인하기" variant="secondary" onPress={() => router.push({ pathname: '/auth/sign-in', params: { returnTo: `/events/${id}` } })} /></Card>}
    {event.requiresMemberVerification && user && !user.isMemberVerified && <Notice>이 행사는 성도 인증 후 신청할 수 있어요. 내 계정에서 인증을 요청해 주세요.</Notice>}
    {registration ? <Button label="내 신청 확인하기" onPress={apply} /> : event.registrationEnabled ? <Button label={!user && status.canApply ? '로그인하고 신청하기' : user && event.requiresMemberVerification && !user.isMemberVerified ? '성도 인증 요청하러 가기' : status.canApply ? '행사 신청하기' : status.label} disabled={!status.canApply} onPress={apply} /> : <Notice>앱에서 신청을 받지 않는 일정입니다. 상세 안내를 확인해 주세요.</Notice>}
    {event.sourceUrl && <Button label="주보 원문 보기 ↗" variant="ghost" onPress={() => void action.run(async () => { if (!/^https?:\/\//i.test(event.sourceUrl!)) throw new Error('원문 주소를 확인할 수 없습니다.'); await Linking.openURL(event.sourceUrl!); })} />}
    {event.retreatSlug && <Button label="느동수 홈 보기" variant="secondary" onPress={() => router.push('/dongsu')} />}
    {user?.role === 'admin' && <Button label="이 행사 관리하기" variant="secondary" onPress={() => router.push({ pathname: '/manage/events/[id]', params: { id } })} />}
    {action.error && <Notice danger>{action.error}</Notice>}
  </Screen>;
}
const styles = StyleSheet.create({ lockTitle: { color: palette.forest, fontSize: 17, fontWeight: '700' } });
