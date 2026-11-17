import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { AppText as Text } from '@/components/app-text';
import { AppIcon } from '@/components/app-icon';
import { CommunityArtwork } from '@/components/community-artwork';
import { api } from '@/services/api';
import { useResource } from '@/hooks/use-resource';
import { RetreatSchedule } from '@/components/retreat-ui';
import { Badge, Body, Button, Card, ErrorState, LoadingState, Screen, Section } from '@/components/ui';
import { palette } from '@/theme/tokens';

const monthDay = (value: string) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', weekday: 'short' }).format(new Date(value));

export default function DongsuScreen() {
  const resource = useResource(useCallback(() => api.getRetreat(), []));
  if (resource.loading && !resource.data) return <Screen eyebrow="NEHEMIAH WINTER RETREAT" title="느동수"><LoadingState label="함께할 겨울 이야기를 불러오고 있어요" /></Screen>;
  if (resource.error || !resource.data) return <Screen eyebrow="NEHEMIAH WINTER RETREAT" title="느동수"><ErrorState message={resource.error || '수련회 안내를 불러오지 못했습니다.'} onRetry={() => void resource.reload()} /></Screen>;
  const camp = resource.data;
  const apply = () => { const path = camp.registrationPath.startsWith('/retreats/') ? camp.registrationPath : '/retreats/nehemiah-winter/apply'; router.push(path as never); };
  const applyLabel = camp.isDemo ? '가상 수련회 신청하기' : `${camp.shortName} 신청하기`;
  const year = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric' }).format(new Date(camp.startsAt));
  return <Screen eyebrow="우리, 함께 떠나요" title="느헤미야 동계수련회" subtitle="말씀과 쉼으로 채우는 따뜻한 겨울." refreshing={resource.loading} onRefresh={() => void resource.reload()}>
    <Card style={styles.hero}>
      <View style={styles.heroTop}><View style={styles.heroLabel}><AppIcon name="tent" size={16} color={palette.accent} /><Text style={styles.kicker}>우리의 겨울 이야기</Text></View>{camp.isDemo && <Badge label="가상 행사" tone="gold" />}</View>
      <View style={styles.heroMain}>
        <View style={styles.heroWords}><Text style={styles.theme}>{camp.theme.replace(/,\s*/, ',\n')}</Text><Text style={styles.heroCaption}>말씀 앞에서 새로워지는{`\n`}우리의 겨울, 우리의 공동체.</Text></View>
        <CommunityArtwork variant="retreat" compact style={styles.heroArtwork} />
      </View>
      <View style={styles.scriptureRow}><View style={styles.scriptureIcon}><AppIcon name="book" size={17} color={palette.forest} /></View><View style={styles.scriptureWords}><Text style={styles.scripture}>“{camp.scripture.excerpt}”</Text><Text style={styles.reference}>{camp.scripture.reference}</Text></View></View>
      <Button label={applyLabel} onPress={apply} />
    </Card>
    {camp.isDemo && <View style={styles.demoNote}><AppIcon name="tent" size={17} color={palette.muted} /><Text style={styles.demoText}>앱 체험을 위한 가상 행사예요. 일정·장소·말씀은 실제 교회 공지가 아닙니다.</Text></View>}

    <View style={styles.summaryPair}>
      <View style={[styles.summaryCard, styles.whenCard]}><View style={styles.summaryHeading}><AppIcon name="calendar" size={19} color={palette.forest} /><Text style={styles.summaryLabel}>언제 만날까요</Text></View><Text style={styles.summaryValue}>{monthDay(camp.startsAt)}{`\n`}— {monthDay(camp.endsAt)}</Text><Text style={styles.summaryCaption}>{year} · 함께하는 2박 3일</Text></View>
      <View style={[styles.summaryCard, styles.whereCard]}><View style={styles.summaryHeading}><AppIcon name="map-pin" size={19} color={palette.forest} /><Text style={styles.summaryLabel}>함께할 곳</Text></View><Text style={styles.summaryValue}>{camp.location.name}</Text><Text style={styles.summaryCaption}>{camp.location.address}</Text></View>
    </View>

    <View style={styles.introduction}><View style={styles.introRule} /><Text accessibilityRole="header" style={styles.introTitle}>서로의 삶을{`\n`}함께 세우는 시간.</Text><Body muted>{camp.description}</Body></View>
    <Section title="함께 보낼 3일" right={<Text style={styles.sectionNote}>말씀과 쉼</Text>}><RetreatSchedule camp={camp} /></Section>

    <Card style={styles.invitation}>
      <View style={styles.invitationHeader}><View style={styles.invitationMark}><AppIcon name="heart" size={21} color={palette.forest} /></View><Text style={styles.invitationEyebrow}>당신의 자리가 있어요</Text></View>
      <Text style={styles.invitationTitle}>함께할 마음을{`\n`}전해 주세요.</Text>
      <Text style={styles.invitationBody}>신청서는 로그인 없이 먼저 작성할 수 있어요. 최종 접수할 때 카카오 계정으로 로그인해 주세요.</Text>
      <Button label={applyLabel} onPress={apply} />
      {camp.isDemo && <Text style={styles.invitationCaption}>실제 교회 접수가 아닌 가상 행사 신청입니다.</Text>}
    </Card>
    <View style={styles.footer}><View style={styles.footerMark}><AppIcon name="heart" size={17} color={palette.forest} /></View><Text style={styles.footerTitle}>함께여서 더 따뜻한 겨울.</Text><Text style={styles.footerText}>선한목자 젊은이교회</Text></View>
  </Screen>;
}
const styles = StyleSheet.create({
  hero: { backgroundColor: palette.peach, borderColor: palette.peach, padding: 22, gap: 24, borderRadius: 30 },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 9 },
  heroLabel: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 18, backgroundColor: palette.surface },
  kicker: { color: palette.accent, fontSize: 12, lineHeight: 19, fontWeight: '600' },
  heroMain: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 16 },
  heroWords: { flex: 1, flexBasis: 145, minWidth: 145, gap: 16 },
  theme: { color: palette.ink, fontSize: 30, lineHeight: 43, fontWeight: '700', letterSpacing: -0.8 },
  heroCaption: { color: palette.accent, fontSize: 14, lineHeight: 24 },
  heroArtwork: { width: 108, height: 146, borderRadius: 54, borderWidth: 4, borderColor: palette.surface },
  scriptureRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 11, backgroundColor: palette.surface, borderRadius: 20, padding: 16 },
  scriptureIcon: { width: 35, height: 35, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: palette.sageLight },
  scriptureWords: { flex: 1, gap: 7 }, scripture: { color: palette.ink, fontSize: 16, lineHeight: 27 },
  reference: { color: palette.muted, fontSize: 12, lineHeight: 20 },
  demoNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, paddingHorizontal: 3, marginTop: -5 },
  demoText: { flex: 1, color: palette.muted, fontSize: 12, lineHeight: 21 },
  summaryPair: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  summaryCard: { flex: 1, flexBasis: 145, minWidth: 140, padding: 18, borderRadius: 24, gap: 16 },
  whenCard: { backgroundColor: palette.sageLight }, whereCard: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  summaryHeading: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 7 },
  summaryLabel: { color: palette.forest, fontSize: 12, lineHeight: 20, fontWeight: '600' },
  summaryValue: { color: palette.forestDark, fontSize: 16, lineHeight: 27, fontWeight: '600', letterSpacing: -0.6 },
  summaryCaption: { color: palette.muted, fontSize: 12, lineHeight: 21 },
  introduction: { paddingHorizontal: 3, paddingVertical: 20, gap: 18 },
  introRule: { width: 32, height: 4, borderRadius: 2, backgroundColor: palette.accent },
  introTitle: { color: palette.ink, fontSize: 26, lineHeight: 39, letterSpacing: -0.6, fontWeight: '700' },
  sectionNote: { color: palette.muted, fontSize: 12, lineHeight: 20 },
  invitation: { backgroundColor: palette.sageLight, borderColor: palette.sageLight, padding: 24, borderRadius: 30, gap: 20, marginTop: 5 },
  invitationHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  invitationMark: { width: 40, height: 40, borderRadius: 20, backgroundColor: palette.surface, alignItems: 'center', justifyContent: 'center' },
  invitationEyebrow: { color: palette.forest, fontSize: 12, lineHeight: 20, fontWeight: '600' },
  invitationTitle: { color: palette.ink, fontSize: 28, lineHeight: 41, fontWeight: '700', letterSpacing: -0.6 },
  invitationBody: { color: palette.forest, fontSize: 14, lineHeight: 25 },
  invitationCaption: { color: palette.muted, fontSize: 12, lineHeight: 20, textAlign: 'center' },
  footer: { paddingTop: 16, paddingBottom: 23, gap: 7, alignItems: 'center' },
  footerMark: { width: 37, height: 37, borderRadius: 19, backgroundColor: palette.sageLight, alignItems: 'center', justifyContent: 'center', marginBottom: 7 },
  footerTitle: { color: palette.forest, fontSize: 16, lineHeight: 26 },
  footerText: { color: palette.muted, fontSize: 12, lineHeight: 20 },
});
