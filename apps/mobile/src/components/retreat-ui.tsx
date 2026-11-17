import { Pressable, StyleSheet, View } from 'react-native';
import { AppText as Text } from '@/components/app-text';
import { AppIcon } from '@/components/app-icon';
import type { DepartureOption, Gender, RetreatDetail, RetreatRegistration } from '@/domain/types';
import { formatDate } from '@/components/event-card';
import { Badge, Body, Card, DetailRow, Divider, Row, common } from '@/components/ui';
import { palette } from '@/theme/tokens';

export function genderLabel(value: Gender | '') { return ({ male: '남성', female: '여성', other: '기타', '': '미입력' })[value]; }
export function departureLabel(camp: RetreatDetail, option: DepartureOption) { return camp.departureOptions.find(item => item.id === option)?.label || ({ main: '본대', late: '후발대', car: '자차', other: '기타' })[option]; }
export function DepartureSummary({ camp, option, note }: { camp: RetreatDetail; option: DepartureOption; note?: string | null }) {
  const departure = camp.departureOptions.find(item => item.id === option);
  return <><DetailRow label="이동 방식" value={departureLabel(camp, option)} />{departure?.departureAt && <DetailRow label="출발 시각" value={formatDate(departure.departureAt)} />}{note && <DetailRow label="출발 메모" value={note} />}</>;
}
export function RetreatChoice({ label, description, selected, disabled = false, onPress }: { label: string; description?: string; selected: boolean; disabled?: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="radio" accessibilityState={{ selected, checked: selected, disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.choice, selected && styles.selected, disabled && styles.locked, pressed && !disabled && { opacity: 0.75 }]}><View style={styles.choiceHeading}><Text style={[styles.choiceLabel, selected && { color: palette.forest }]}>{label}</Text><View style={styles.choiceState}>{selected && disabled && <Text style={styles.lockedLabel}>등록 정보</Text>}<View style={[styles.radio, selected && styles.radioSelected]}>{selected && <AppIcon name="check" size={13} color={palette.white} strokeWidth={2.2} />}</View></View></View>{description && <Text style={styles.choiceDescription}>{description}</Text>}</Pressable>;
}
export function RetreatRegistrationSummary({ camp, registration, includePrayer = true }: { camp: RetreatDetail; registration: RetreatRegistration; includePrayer?: boolean }) {
  return <Card style={styles.receipt}><Row between><Text style={common.title}>{registration.participantName} 님</Text><Badge label={registration.status === 'confirmed' ? '접수 완료' : '신청 취소'} tone={registration.status === 'confirmed' ? 'green' : 'muted'} /></Row><View style={styles.confirmation}><View style={styles.confirmationHeading}><AppIcon name="bookmark" size={16} color={palette.forest} /><Text style={styles.confirmationLabel}>MY RETREAT PASS</Text></View><Text selectable style={styles.confirmationCode}>{registration.confirmationCode}</Text><Text style={styles.confirmationHelp}>현장에서 이름과 함께 보여 주세요.</Text></View><DetailRow label="또래" value={registration.answers.peerGroup} /><DetailRow label="성별" value={genderLabel(registration.answers.gender)} /><DetailRow label="연락처" value={registration.answers.phoneNumber} /><Divider /><DepartureSummary camp={camp} option={registration.answers.departureOption} note={registration.answers.departureNote} />{includePrayer && registration.answers.prayerRequest && <><Divider /><View style={styles.prayerHeading}><AppIcon name="heart" size={16} color={palette.forest} /><Text style={styles.prayerLabel}>함께 기도할 제목</Text></View><Body>{registration.answers.prayerRequest}</Body></>}</Card>;
}
export function RetreatSchedule({ camp }: { camp: RetreatDetail }) {
  return <View style={styles.days}>{camp.schedule.map((day, dayIndex) => <Card key={day.date} style={styles.dayCard}><View style={styles.dayHeading}><View style={styles.dayNumber}><Text style={styles.dayNumberText}>{String(dayIndex + 1).padStart(2, '0')}</Text></View><View style={common.grow}><Text style={styles.dayDate}>{formatDate(`${day.date}T00:00:00+09:00`, true)}</Text><Text style={styles.dayTitle}>{day.label}</Text></View></View><View style={styles.timeline}>{day.items.map((item, index) => <View key={`${day.date}-${index}`} style={styles.scheduleRow}><Text style={styles.scheduleTime}>{item.time}</Text><View style={styles.timelineRail}><View style={[styles.timelineDot, index === 0 && styles.timelineDotFirst]} />{index < day.items.length - 1 && <View style={styles.timelineLine} />}</View><View style={[styles.scheduleContent, index === day.items.length - 1 && styles.scheduleContentLast]}><Text style={styles.scheduleTitle}>{item.title}</Text>{item.description && <Text style={styles.scheduleDescription}>{item.description}</Text>}</View></View>)}</View></Card>)}</View>;
}
const styles = StyleSheet.create({
  choice: { paddingHorizontal: 18, paddingVertical: 17, borderWidth: 1, borderColor: palette.border, borderRadius: 19, backgroundColor: palette.surface, gap: 8 },
  selected: { backgroundColor: palette.sageLight, borderColor: palette.forest }, locked: { opacity: 0.78 },
  choiceHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  choiceLabel: { flex: 1, fontSize: 15, lineHeight: 24, fontWeight: '600', color: palette.ink },
  choiceState: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  lockedLabel: { color: palette.forest, fontSize: 12, lineHeight: 20 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1, borderColor: '#BFC7B8', alignItems: 'center', justifyContent: 'center' },
  radioSelected: { backgroundColor: palette.forest, borderColor: palette.forest },
  choiceDescription: { fontSize: 12, lineHeight: 21, color: palette.muted },
  receipt: { borderRadius: 25, gap: 14 },
  confirmation: { backgroundColor: palette.sageLight, borderRadius: 19, padding: 19, gap: 11, marginVertical: 5 },
  confirmationHeading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  confirmationLabel: { color: palette.forest, fontSize: 12, lineHeight: 20, letterSpacing: 1.3 },
  confirmationCode: { color: palette.forestDark, fontSize: 28, lineHeight: 40, fontWeight: '600', letterSpacing: 1.3 },
  confirmationHelp: { color: palette.muted, fontSize: 12, lineHeight: 20 },
  prayerHeading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  prayerLabel: { color: palette.forest, fontSize: 12, lineHeight: 22 },
  days: { gap: 15 }, dayCard: { borderRadius: 25, padding: 20, gap: 21 },
  dayHeading: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  dayNumber: { width: 44, height: 51, borderRadius: 15, backgroundColor: palette.sage, alignItems: 'center', justifyContent: 'center' },
  dayNumberText: { color: palette.forest, fontSize: 23, lineHeight: 32 },
  dayDate: { color: palette.muted, fontSize: 12, lineHeight: 20, marginBottom: 3 },
  dayTitle: { color: palette.forestDark, fontSize: 16, lineHeight: 26, fontWeight: '600', letterSpacing: -0.3 },
  timeline: { gap: 0 }, scheduleRow: { flexDirection: 'row', gap: 11, alignItems: 'stretch' },
  scheduleTime: { width: 43, fontSize: 12, lineHeight: 24, color: palette.muted },
  timelineRail: { width: 10, alignItems: 'center', paddingTop: 7 },
  timelineDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#B5C1AB' },
  timelineDotFirst: { backgroundColor: palette.forest },
  timelineLine: { flex: 1, width: 1, backgroundColor: palette.border, marginTop: 6, marginBottom: -1 },
  scheduleContent: { flex: 1, paddingBottom: 25, gap: 4 }, scheduleContentLast: { paddingBottom: 1 },
  scheduleTitle: { fontSize: 14, lineHeight: 24, color: palette.ink, fontWeight: '600' },
  scheduleDescription: { fontSize: 12, lineHeight: 21, color: palette.muted },
});
