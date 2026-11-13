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
    <View style={styles.dateTile} accessible={false}>
      <Text style={styles.month}>{date.month}</Text>
      <Text style={[styles.day, date.day === '미정' && styles.undated]}>{date.day}</Text>
    </View>
    <View style={styles.copy}>
      <Text numberOfLines={1} style={styles.title}>{event.title}</Text>
      <Text numberOfLines={1} style={styles.metadata}>{metadata}</Text>
    </View>
    <View style={styles.trailing}>
      <Text style={[styles.status, status.tone === 'green' && styles.available, status.tone === 'gold' && styles.scheduled, status.tone === 'red' && styles.cancelled]}>{status.label}</Text>
      <AppIcon name="chevron-right" size={13} color={palette.muted} />
    </View>
  </Pressable>;
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 62, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 14, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  pressed: { opacity: 0.75 },
  dateTile: { minWidth: 34, alignItems: 'center', paddingRight: 9, borderRightWidth: 1, borderRightColor: palette.border },
  month: { color: palette.muted, fontSize: 9, lineHeight: 13 },
  day: { color: palette.forest, fontSize: 20, lineHeight: 25, fontWeight: '700' },
  undated: { fontSize: 12 },
  copy: { flex: 1, minWidth: 0, gap: 3 },
  title: { color: palette.ink, fontSize: 13, lineHeight: 20, fontWeight: '700', letterSpacing: -0.2 },
  metadata: { color: palette.muted, fontSize: 10, lineHeight: 16 },
  trailing: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 },
  status: { color: palette.muted, fontSize: 9, lineHeight: 16 },
  available: { color: palette.forest, fontWeight: '600' },
  scheduled: { color: palette.gold },
  cancelled: { color: palette.danger },
});
