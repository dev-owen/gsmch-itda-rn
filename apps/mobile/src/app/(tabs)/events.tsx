import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { AppText as Text, AppTextInput as TextInput } from '@/components/app-text';
import { AppIcon } from '@/components/app-icon';
import { api } from '@/services/api';
import { useSession } from '@/services/session';
import { useResource } from '@/hooks/use-resource';
import { useNow } from '@/hooks/use-now';
import { categoryLabel } from '@/components/event-card';
import { CompactEventCard } from '@/components/compact-event-card';
import { EventDeck } from '@/components/event-deck';
import { filterEvents, upcomingEvents, weekRangeLabel, type EventPeriod } from '@/domain/event-discovery';
import { Button, EmptyState, ErrorState, LoadingState, Screen } from '@/components/ui';
import { palette } from '@/theme/tokens';

export default function EventsScreen() {
  const { user } = useSession();
  const scope = `${user?.id || 'public'}:${user?.isMemberVerified}:${user?.role}:${user?.status}`;
  const resource = useResource(useCallback(() => api.listEvents({ period: 'all' }), []), scope);
  const now = useNow();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('전체');
  const [period, setPeriod] = useState<EventPeriod>('week');
  const categories = useMemo(() => ['전체', ...new Set((resource.data || []).map(item => item.category).filter(Boolean))], [resource.data]);
  const deckEvents = useMemo(() => upcomingEvents(resource.data || [], now), [resource.data, now]);
  const filtered = useMemo(() => filterEvents(resource.data || [], { period, category, query }, now), [resource.data, category, period, query, now]);
  const filtering = !!query.trim() || category !== '전체';
  const resetFilters = () => { setQuery(''); setCategory('전체'); setPeriod('week'); };

  return <Screen refreshing={resource.loading && !!resource.data} onRefresh={() => void resource.reload()}>
    <View style={styles.brandRow}>
      <View style={styles.brand}><View style={styles.brandMark}><AppIcon name="home" size={22} color={palette.surface} /></View><View style={styles.brandName}><Text style={styles.wordmark}>잇다</Text><Text style={styles.churchName}>선한목자 젊은이교회</Text></View></View>
      <Pressable accessibilityRole="button" accessibilityLabel={user ? '내 계정 보기' : '로그인하기'} onPress={() => router.push(user ? '/account' : '/auth/sign-in')} style={({ pressed }) => [styles.accountButton, pressed && styles.pressed]}><AppIcon name="user" size={21} color={palette.forest} /></Pressable>
    </View>

    <View style={styles.introduction}><Text style={styles.greeting}>{user ? `${user.name || '우리'}님, 반가워요` : '우리의 다음 만남을 찾아보세요'}</Text><Text accessibilityRole="header" style={styles.headline}>반가운 소식을 넘겨보세요</Text></View>

    {!resource.error && deckEvents.length > 0 && <EventDeck key={`${scope}:${deckEvents.map(event => event.id).join(',')}`} events={deckEvents} now={now} />}

    <View style={styles.discovery}>
      <View style={styles.sectionHeader}><View style={styles.listHeading}><Text accessibilityRole="header" style={styles.sectionTitle}>소식 모아보기</Text><Text style={styles.listSubtitle}>{period === 'week' ? `${weekRangeLabel(now)} · 오늘부터 7일간` : period === 'past' ? '지나온 소식도 다시 찾아보세요' : '다가오는 모든 소식을 한눈에'}</Text></View><View style={styles.listIcon}><AppIcon name="calendar" size={19} /></View></View>
      <View style={styles.searchBar}><AppIcon name="search" size={18} color={palette.muted} /><TextInput accessibilityLabel="소식 검색" placeholder="제목, 장소, 내용으로 검색" placeholderTextColor={palette.muted} value={query} onChangeText={setQuery} returnKeyType="search" clearButtonMode="while-editing" style={styles.searchInput} />{!!query && <Pressable accessibilityRole="button" accessibilityLabel="검색어 지우기" onPress={() => setQuery('')} style={styles.clearSearch}><Text style={styles.clearSearchText}>지우기</Text></Pressable>}</View>
      <View style={styles.segment}>
        {([{ value: 'week', label: '이번 7일' }, { value: 'all', label: '전체 소식' }, { value: 'past', label: '지난 소식' }] as const).map(item => <Pressable key={item.value} accessibilityRole="button" accessibilityState={{ selected: period === item.value }} onPress={() => setPeriod(item.value)} style={[styles.segmentButton, period === item.value && styles.segmentSelected]}><Text style={[styles.segmentText, period === item.value && styles.segmentTextSelected]}>{item.label}</Text></Pressable>)}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categories}>{categories.map(item => <Pressable key={item} accessibilityRole="button" accessibilityState={{ selected: category === item }} onPress={() => setCategory(item)} style={[styles.categoryPill, category === item && styles.categorySelected]}><Text style={[styles.categoryText, category === item && styles.categoryTextSelected]}>{item === '전체' ? item : categoryLabel(item)}</Text></Pressable>)}</ScrollView>

    {resource.loading && !resource.data ? <LoadingState label="교회 일정을 불러오고 있어요" /> : resource.error ? <ErrorState message={resource.error} onRetry={() => void resource.reload()} /> : <>
      <Text accessibilityLiveRegion="polite" style={styles.resultCount}>{filtered.length}개의 소식{period === 'week' && !filtering ? ' · 가까운 일정부터' : ''}</Text>
      <View style={styles.feed}>{filtered.map(event => <CompactEventCard key={event.id} event={event} now={now} />)}</View>
      {!filtered.length && <EmptyState title={filtering ? '조건에 맞는 소식이 없어요' : period === 'week' ? '이번 7일은 등록된 일정이 없어요' : period === 'past' ? '아직 지난 소식이 없어요' : '다음 만남을 준비하고 있어요'} description={filtering ? '검색어나 분류를 바꿔 다시 찾아보세요.' : period === 'week' ? '전체 소식에서 앞으로의 만남을 찾아보세요.' : '새로운 소식이 등록되면 이곳에서 확인할 수 있어요.'} action={filtering ? <Button label="필터 초기화" variant="secondary" onPress={resetFilters} /> : period === 'week' ? <Button label="전체 소식 보기" variant="secondary" onPress={() => setPeriod('all')} /> : undefined} />}
    </>}
    </View>

    {!user && <View style={styles.publicNote}><View style={styles.publicNoteHeading}><View style={styles.publicNoteIcon}><AppIcon name="users" size={21} color={palette.forest} /></View><View style={styles.publicNoteCopy}><Text style={styles.publicNoteTitle}>함께할 준비가 되셨나요?</Text><Text style={styles.publicNoteText}>일정은 로그인 없이도 볼 수 있어요.</Text></View></View><Button label="로그인하고 행사 신청하기" variant="ghost" onPress={() => router.push('/auth/sign-in')} /></View>}
    <View style={styles.footer}><View style={styles.footerLine} /><Text style={styles.footerText}>WITH JESUS, LIKE JESUS</Text><View style={styles.footerLine} /></View>
  </Screen>;
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.75 }, brandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 15, paddingTop: 3, paddingBottom: 3 }, brand: { flexDirection: 'row', alignItems: 'center', gap: 10 }, brandMark: { width: 40, height: 40, borderRadius: 14, backgroundColor: palette.forest, justifyContent: 'center', alignItems: 'center' }, brandName: { gap: 1 }, wordmark: { fontSize: 19, lineHeight: 25, color: palette.forest, fontWeight: '700', letterSpacing: -0.5 }, churchName: { color: palette.muted, fontSize: 10, lineHeight: 17 }, accountButton: { width: 43, height: 43, borderRadius: 22, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, alignItems: 'center', justifyContent: 'center' },
  introduction: { gap: 6, paddingTop: 1 }, greeting: { color: palette.muted, fontSize: 12, lineHeight: 21 }, headline: { color: palette.ink, fontSize: 26, lineHeight: 38, letterSpacing: -0.8, fontWeight: '700' },
  discovery: { gap: 12, paddingTop: 8 }, listHeading: { flex: 1, gap: 3 }, listSubtitle: { color: palette.muted, fontSize: 11, lineHeight: 19 }, listIcon: { width: 38, height: 38, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.stone }, searchBar: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 15, minHeight: 48, paddingHorizontal: 14, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border }, searchInput: { flex: 1, paddingVertical: 12, paddingHorizontal: 0, minHeight: 46, color: palette.ink, fontSize: 12 }, clearSearch: { minHeight: 44, justifyContent: 'center', paddingLeft: 4 }, clearSearchText: { fontSize: 11, color: palette.muted },
  segment: { flexDirection: 'row', padding: 5, backgroundColor: '#EAE7DC', borderRadius: 19, gap: 5 }, segmentButton: { flex: 1, minHeight: 43, borderRadius: 15, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 10 }, segmentSelected: { backgroundColor: palette.surface }, segmentText: { color: palette.muted, fontSize: 13, lineHeight: 22, fontWeight: '500' }, segmentTextSelected: { color: palette.forest, fontWeight: '700' }, categories: { gap: 8, paddingRight: 4, paddingVertical: 1 }, categoryPill: { borderRadius: 18, borderWidth: 1, borderColor: palette.border, paddingHorizontal: 17, paddingVertical: 8, minHeight: 38, backgroundColor: palette.surface, alignItems: 'center', justifyContent: 'center' }, categorySelected: { backgroundColor: palette.forest, borderColor: palette.forest }, categoryText: { color: palette.muted, fontSize: 12, lineHeight: 20 }, categoryTextSelected: { color: palette.surface, fontWeight: '600' },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingTop: 2 }, sectionTitle: { color: palette.ink, fontSize: 20, lineHeight: 30, fontWeight: '700', letterSpacing: -0.4 }, resultCount: { color: palette.muted, fontSize: 11, lineHeight: 19 }, feed: { gap: 6 },
  publicNote: { gap: 16, borderRadius: 24, padding: 18, backgroundColor: '#EDF2E7' }, publicNoteHeading: { flexDirection: 'row', alignItems: 'center', gap: 12 }, publicNoteIcon: { width: 42, height: 42, borderRadius: 16, backgroundColor: '#DDE6CE', alignItems: 'center', justifyContent: 'center' }, publicNoteCopy: { flex: 1, gap: 4 }, publicNoteTitle: { color: palette.forest, fontSize: 14, lineHeight: 23, fontWeight: '700' }, publicNoteText: { color: palette.muted, fontSize: 11, lineHeight: 20 }, footer: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 }, footerLine: { flex: 1, height: 1, backgroundColor: palette.border }, footerText: { color: palette.gold, fontSize: 9, lineHeight: 18, letterSpacing: 1.1 },
});
