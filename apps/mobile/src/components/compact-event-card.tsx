import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { AppText as Text } from '@/components/app-text';
import { AppIcon } from '@/components/app-icon';
import { categoryLabel, eventStatus, formatEventRange } from '@/components/event-card';
import type { EventItem } from '@/domain/types';
import { isPastEvent } from '@/domain/event-discovery';
import { palette } from '@/theme/tokens';

function compactDate(event: EventItem) {
  const date = event.startsAt ? new Date(event.startsAt) : null;
  if (!date || Number.isNaN(date.getTime())) return { month: '일정', day: '미정', time: '일정 추후 안내' };
  const options = { timeZone: 'Asia/Seoul' };
  return {
    month: new Intl.DateTimeFormat('ko-KR', { ...options, month: 'short' }).format(date),
    day: new Intl.DateTimeFormat('ko-KR', { ...options, day: 'numeric' }).format(date).replace(/일$/, ''),
    time: event.allDay ? '종일' : new Intl.DateTimeFormat('ko-KR', { ...options, hour: 'numeric', minute: '2-digit' }).format(date),
  };
}

export function CompactEventCard({ event, now }: { event: EventItem; now: number }) {
  const status = event.lifecycleStatus !== 'cancelled' && event.registrationStatus !== 'cancelled' && isPastEvent(event, now)
    ? { label: '종료된 행사', tone: 'muted' as const }
    : eventStatus(event, now);
  const date = compactDate(event);
  const metadata = [event.isDemo && '가상 행사', categoryLabel(event.category), date.time, event.location || '장소 추후 안내'].filter(Boolean).join(' · ');
  const label = [event.isDemo && '가상 행사', event.title, formatEventRange(event), event.location || '장소 추후 안내', status.label, event.requiresMemberVerification && '성도 인증 후 신청'].filter(Boolean).join(', ');

  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={label}
    accessibilityHint="소식의 자세한 안내를 엽니다"
    onPress={() => router.push({ pathname: '/events/[id]', params: { id: event.id } })}
    style={({ pressed }) => [styles.card, pressed && styles.pressed]}
  >
    <View style={[styles.dateTile, event.category === 'recruitment' && styles.peachTile]} accessible={false}>
      <Text style={styles.month}>{date.month}</Text>
      <Text style={[styles.day, date.day === '미정' && styles.undated]}>{date.day}</Text>
    </View>
    <View style={styles.copy}>
      <Text numberOfLines={2} style={styles.title}>{event.title}</Text>
      <Text numberOfLines={2} style={styles.metadata}>{metadata}</Text>
      <Text style={[styles.status, status.tone === 'green' && styles.available, status.tone === 'gold' && styles.scheduled, status.tone === 'red' && styles.cancelled]}>{status.label}</Text>
    </View>
    <View style={styles.trailing}>
      <AppIcon name="chevron-right" size={13} color={palette.muted} />
    </View>
  </Pressable>;
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 100, paddingVertical: 16, paddingHorizontal: 14, borderRadius: 22, backgroundColor: palette.surface },
  pressed: { opacity: 0.75 },
  dateTile: { width: 52, minHeight: 64, alignItems: 'center', justifyContent: 'center', paddingVertical: 8, borderRadius: 16, backgroundColor: palette.sageLight },
  peachTile: { backgroundColor: palette.accentLight },
  month: { color: palette.forest, fontSize: 12, lineHeight: 18 },
  day: { color: palette.forestDark, fontSize: 25, lineHeight: 31, fontWeight: '700', fontVariant: ['tabular-nums'] },
  undated: { fontSize: 14 },
  copy: { flex: 1, minWidth: 0, gap: 5 },
  title: { color: palette.ink, fontSize: 16, lineHeight: 24, fontWeight: '700', letterSpacing: -0.3 },
  metadata: { color: palette.muted, fontSize: 12, lineHeight: 20 },
  trailing: { alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  status: { alignSelf: 'flex-start', color: palette.muted, fontSize: 12, lineHeight: 20 },
  available: { color: palette.forest, fontWeight: '600' },
  scheduled: { color: palette.gold },
  cancelled: { color: palette.danger },
});
