import { AppText as Text } from '@/components/app-text';
import { useEffect } from 'react';
import { useLocalSearchParams, router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { AppIcon } from '@/components/app-icon';
import { CommunityArtwork } from '@/components/community-artwork';
import { useSession } from '@/services/session';
import { useAction } from '@/hooks/use-resource';
import { Body, Button, Card, Notice, Screen } from '@/components/ui';
import { palette } from '@/theme/tokens';
import type { Provider } from '@/domain/types';

export default function SignInScreen() {
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const { user, signIn } = useSession();
  const action = useAction();
  const destination = typeof returnTo === 'string' && returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/account';
  useEffect(() => { if (user) router.replace(destination as never); }, [user, destination]);
  const login = (provider: Provider) => void action.run(async () => { await signIn(provider, destination); });
  return <Screen back eyebrow="WELCOME TO ITDA" title={'반가워요,\n함께할 자리가 있어요.'} subtitle="선한목자 젊은이교회 · 우리의 만남을 잇다">
    <CommunityArtwork variant="gathering" style={styles.artwork} />
    <Card><View style={styles.heading}><View style={styles.mark}><AppIcon name="user" size={20} /></View><Text style={styles.cardTitle}>나의 계정으로 시작하기</Text></View><Body muted>자주 사용하는 계정으로 로그인하고, 함께할 만남을 차근차근 모아 보세요.</Body>
      <Button label="카카오로 계속하기" variant="kakao" busy={action.busy} onPress={() => login('kakao')} />
      <Button label="Google로 계속하기" variant="ghost" busy={action.busy} onPress={() => login('google')} />
      {action.error && <Notice danger>{action.error}</Notice>}
    </Card>
    <Body muted>로그인 정보는 계정 확인에 사용합니다. 행사에 신청할 때 실제 참가 이름을 별도로 확인해 주세요.</Body>
    <Button label="먼저 행사 둘러보기" variant="ghost" onPress={() => router.replace('/events')} />
  </Screen>;
}
const styles = StyleSheet.create({ artwork: { height: 184, borderRadius: 28 }, heading: { flexDirection: 'row', alignItems: 'center', gap: 11 }, mark: { width: 39, height: 39, borderRadius: 15, backgroundColor: palette.sageLight, alignItems: 'center', justifyContent: 'center' }, cardTitle: { color: palette.forestDark, fontSize: 18, lineHeight: 28, fontWeight: '700', flex: 1 } });
