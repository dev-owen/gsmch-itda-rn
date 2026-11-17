import { AppText as Text } from '@/components/app-text';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import type { EventItem } from '@/domain/types';
import { AppIcon } from '@/components/app-icon';
import { CommunityArtwork } from '@/components/community-artwork';
import { palette } from '@/theme/tokens';

export function categoryLabel(category?: string) {
  if (category === 'event') return '행사';
  if (category === 'recruitment') return '모집';
  return category || '교회 행사';
}

export function formatDate(value?: string | null, allDay = false) {
  if (!value) return '일정 추후 안내';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '일정 확인 중';
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'short', ...(allDay ? {} : { hour: 'numeric', minute: '2-digit' }) }).format(date);
}

export function formatEventRange(event: Pick<EventItem, 'startsAt' | 'endsAt' | 'allDay'>) {
  const start = formatDate(event.startsAt, event.allDay);
  if (!event.startsAt) return start;
  const startDate = new Date(event.startsAt);
  const endDate = event.endsAt ? new Date(event.endsAt) : null;
  const suffix = event.allDay ? ' · 종일' : '';
  if (!endDate || Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || startDate.getTime() === endDate.getTime()) return `${start}${suffix}`;
  const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });
  if (dayFormat.format(startDate) === dayFormat.format(endDate)) {
    if (event.allDay) return `${start}${suffix}`;
    const endTime = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: 'numeric', minute: '2-digit' }).format(endDate);
    return `${start} ~ ${endTime}`;
  }
  return `${start} ~ ${formatDate(event.endsAt, event.allDay)}${suffix}`;
}

export function eventStatus(event: EventItem, now: number): { label: string; tone: 'green' | 'gold' | 'red' | 'muted'; canApply: boolean } {
  if (event.lifecycleStatus === 'cancelled' || event.registrationStatus === 'cancelled') return { label: '행사 취소', tone: 'red', canApply: false };
  if (event.lifecycleStatus === 'completed') return { label: '종료된 행사', tone: 'muted', canApply: false };
  if (!event.registrationEnabled || event.registrationStatus === 'disabled') return { label: '일정 안내', tone: 'muted', canApply: false };
  if (event.registrationStatus === 'not_open' || (event.registrationOpensAt && new Date(event.registrationOpensAt).getTime() > now)) return { label: '접수 예정', tone: 'gold', canApply: false };
  if (event.registrationStatus === 'closed' || (event.registrationClosesAt && new Date(event.registrationClosesAt).getTime() <= now)) return { label: '신청 마감', tone: 'muted', canApply: false };
  if (event.publicationStatus !== 'published') return { label: '공개 전', tone: 'muted', canApply: false };
  return { label: '신청 가능', tone: 'green', canApply: true };
}

function artworkVariant(event: EventItem): 'gathering' | 'retreat' | 'service' {
  if (/수련회|캠프|느동수|retreat/i.test(event.title)) return 'retreat';
  if (event.category === 'recruitment' || /봉사|섬김|선교/.test(event.title)) return 'service';
  return 'gathering';
}
function dateTile(event: EventItem) {
  if (!event.startsAt) return { month: '일정', day: '미정' };
  const date = new Date(event.startsAt);
  if (Number.isNaN(date.getTime())) return { month: '일정', day: '확인 중' };
  return { month: new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'short' }).format(date), day: new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', day: 'numeric' }).format(date).replace(/일$/, '') };
}
function openEvent(event: EventItem) { router.push({ pathname: '/events/[id]', params: { id: event.id } }); }

export function FeaturedEventCard({ event, now, preview = false, onPress }: { event: EventItem; now: number; preview?: boolean; onPress?: () => void }) {
  const status = eventStatus(event, now);
  return <Pressable disabled={preview} focusable={!preview} accessibilityRole="button" accessibilityLabel={`${event.isDemo ? '가상 행사, ' : ''}먼저 만나는 소식, ${event.title}, ${formatEventRange(event)}, ${status.label}`} onPress={onPress || (() => openEvent(event))} style={({ pressed }) => [styles.featured, event.category === 'recruitment' && styles.featuredPeach, pressed && styles.pressed]}>
    <View style={styles.featuredTags}><View style={styles.featuredPill}><Text style={styles.featuredPillText}>{categoryLabel(event.category)}</Text></View>{event.isDemo && <View style={styles.demoPill}><Text style={styles.demoText}>가상 행사</Text></View>}<Text style={[styles.featuredStatus, status.tone === 'red' && styles.cancelled]}>{status.label}</Text></View>
    <View style={styles.featuredBody}><View style={styles.featuredCopy}><Text style={styles.featuredEyebrow}>함께할 다음 이야기</Text><Text numberOfLines={3} style={styles.featuredTitle}>{event.title}</Text></View><View accessible={false} importantForAccessibility="no-hide-descendants" style={styles.featuredArtwork}><CommunityArtwork variant={artworkVariant(event)} compact style={styles.featuredArtworkCanvas} /></View></View>
    <View style={styles.featuredMeta}><View style={styles.metaRow}><AppIcon name="calendar" size={15} color={palette.forest} /><Text numberOfLines={2} style={styles.featuredMetaText}>{formatEventRange(event)}</Text></View><View style={styles.metaRow}><AppIcon name="map-pin" size={15} color={palette.forest} /><Text numberOfLines={1} style={styles.featuredMetaText}>{event.location || '장소 추후 안내'}</Text></View>{event.requiresMemberVerification && <View style={styles.metaRow}><AppIcon name="lock" size={14} color={palette.forest} /><Text style={styles.featuredMetaText}>성도 인증 후 신청</Text></View>}</View>
    <View style={styles.featuredFooter}><Text style={styles.featuredAction}>소식 자세히 보기</Text><View style={styles.featuredArrow}><AppIcon name="arrow-up-right" size={21} color={palette.forest} /></View></View>
  </Pressable>;
}

export function EventCard({ event, now }: { event: EventItem; now: number }) {
  const status = eventStatus(event, now);
  const date = dateTile(event);
  return <Pressable accessibilityRole="button" accessibilityLabel={`${event.isDemo ? '가상 행사, ' : ''}${event.title}, ${formatEventRange(event)}, ${status.label}`} onPress={() => openEvent(event)} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
    <View style={[styles.thumbnail, event.category === 'recruitment' && styles.serviceThumbnail]} accessible={false} importantForAccessibility="no-hide-descendants"><CommunityArtwork variant={artworkVariant(event)} compact style={styles.thumbnailCanvas} /><View style={styles.dateTile}><Text style={styles.tileMonth}>{date.month}</Text><Text style={styles.tileDay}>{date.day}</Text></View></View>
    <View style={styles.cardContent}><View style={styles.cardTags}><View style={styles.categoryPill}><Text style={styles.category}>{categoryLabel(event.category)}</Text></View>{event.isDemo && <View style={styles.demoPill}><Text style={styles.demoText}>가상 행사</Text></View>}<Text style={[styles.status, status.tone === 'red' && styles.cancelled]}>{status.label}</Text></View><Text numberOfLines={2} style={styles.title}>{event.title}</Text><View style={styles.metaRow}><AppIcon name="calendar" size={12} color={palette.muted} /><Text style={styles.date}>{formatEventRange(event)}</Text></View><View style={styles.metaRow}><AppIcon name="map-pin" size={12} color={palette.muted} /><Text numberOfLines={1} style={styles.location}>{event.location || '장소 추후 안내'}</Text></View>{!!event.target && <Text numberOfLines={1} style={styles.target}>{event.target}</Text>}{event.requiresMemberVerification && <Text style={styles.member}>성도 인증 후 신청</Text>}</View>
    <View style={styles.cardArrow}><AppIcon name="arrow-right" size={16} color={palette.forest} /></View>
  </Pressable>;
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.8 },
  demoPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, backgroundColor: palette.peach }, demoText: { color: palette.forest, fontSize: 12, lineHeight: 20, fontWeight: '600' },
  featured: { minHeight: 320, backgroundColor: palette.sage, borderRadius: 28, padding: 24, gap: 20, overflow: 'hidden' }, featuredPeach: { backgroundColor: palette.peach },
  featuredTags: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 },
  featuredPill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: palette.surface }, featuredPillText: { color: palette.forest, fontSize: 12, lineHeight: 20, fontWeight: '700' }, featuredStatus: { color: palette.forestDark, fontSize: 12, lineHeight: 20, fontWeight: '600' },
  featuredBody: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 }, featuredCopy: { flex: 1, minWidth: 0, gap: 9 }, featuredEyebrow: { color: palette.forest, fontSize: 12, lineHeight: 20, letterSpacing: 0.2 }, featuredTitle: { color: palette.forestDark, fontSize: 27, lineHeight: 38, fontWeight: '700', letterSpacing: -0.7 }, featuredArtwork: { width: 96, height: 120, justifyContent: 'center', alignItems: 'center' }, featuredArtworkCanvas: { width: 108, height: 118 },
  featuredMeta: { gap: 8 }, metaRow: { flexDirection: 'row', alignItems: 'center', gap: 7 }, featuredMetaText: { flex: 1, color: palette.forestDark, fontSize: 13, lineHeight: 22 }, featuredFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: palette.forestLight, paddingTop: 15, marginTop: 1 }, featuredAction: { color: palette.forestDark, fontSize: 14, lineHeight: 22, fontWeight: '600' }, featuredArrow: { width: 40, height: 40, borderRadius: 20, backgroundColor: palette.surface, alignItems: 'center', justifyContent: 'center' },
  card: { flexDirection: 'row', alignItems: 'center', padding: 15, gap: 13, borderRadius: 24, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border }, thumbnail: { width: 84, minHeight: 112, alignSelf: 'stretch', borderRadius: 19, backgroundColor: palette.peach, overflow: 'hidden', justifyContent: 'flex-start', alignItems: 'center' }, serviceThumbnail: { backgroundColor: palette.sage }, thumbnailCanvas: { width: 104, height: 96 }, dateTile: { minWidth: 50, paddingHorizontal: 8, paddingVertical: 5, backgroundColor: palette.surface, borderRadius: 12, alignItems: 'center', marginBottom: 9, marginTop: -11 }, tileMonth: { color: palette.muted, fontSize: 12, lineHeight: 20 }, tileDay: { color: palette.forest, fontSize: 23, lineHeight: 29, fontWeight: '700' },
  cardContent: { flex: 1, gap: 6 }, cardTags: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 7 }, categoryPill: { backgroundColor: palette.sageLight, borderRadius: 14, paddingHorizontal: 8, paddingVertical: 3 }, category: { color: palette.forest, fontSize: 12, lineHeight: 20, fontWeight: '600' }, status: { color: palette.muted, fontSize: 12, lineHeight: 20 }, cancelled: { color: palette.danger }, title: { color: palette.ink, fontSize: 17, lineHeight: 27, fontWeight: '700', letterSpacing: -0.35 }, date: { flex: 1, color: palette.forest, fontSize: 12, lineHeight: 20 }, location: { flex: 1, color: palette.muted, fontSize: 12, lineHeight: 20 }, target: { color: palette.muted, fontSize: 12, lineHeight: 20 }, member: { color: palette.muted, fontSize: 12, lineHeight: 20 }, cardArrow: { alignSelf: 'flex-start', paddingTop: 4, marginLeft: -5 },
});
