import type { ReactNode } from 'react';
import { router } from 'expo-router';
import { useSession } from '@/services/session';
import { Body, Button, Card, EmptyState, ErrorState, LoadingState, Notice, Screen, common } from '@/components/ui';
import { useAction } from '@/hooks/use-resource';
import { CommunityArtwork } from '@/components/community-artwork';
import { AppText as Text } from '@/components/app-text';
import { FlaticonAttribution } from '@/components/flaticon-attribution';

export function AccessGate({ children, admin = false, returnTo }: { children: ReactNode; admin?: boolean; returnTo?: string }) {
  const { user, loading, error, authErrorCode, refresh, signIn, signOut } = useSession();
  const action = useAction();
  if (admin) return <Screen title="웹에서 행사 운영하기" back><EmptyState title="웹 관리자 대시보드를 이용해 주세요" description="행사·회원·신청자 관리는 웹 관리자 대시보드에서 Google 계정으로 로그인해 이용할 수 있습니다." action={<Button label="행사 보러 가기" variant="secondary" onPress={() => router.replace('/events')} />} /></Screen>;
  if (loading) return <Screen><LoadingState /></Screen>;
  if (!user && authErrorCode === 'KAKAO_LOGIN_REQUIRED') return <Screen title="카카오로 다시 로그인해 주세요"><Card><Body>행사 신청과 내 정보 확인은 카카오 계정으로 로그인해야 합니다.</Body><Button label="카카오로 다시 로그인" variant="kakao" busy={action.busy} onPress={() => void action.run(async () => { await signIn('kakao', returnTo); })} />{action.error && <Notice danger>{action.error}</Notice>}</Card><Button label="행사 둘러보기" variant="ghost" onPress={() => router.replace('/events')} /></Screen>;
  if (!user && error) return <Screen title="계정 연결을 확인해 주세요"><ErrorState message={error} onRetry={() => void refresh()} /><Button label="행사 둘러보기" variant="ghost" onPress={() => router.replace('/events')} />{returnTo === '/account' && <FlaticonAttribution />}</Screen>;
  if (!user) return <Screen title={'나의 만남을,\n한곳에 모아요.'} eyebrow="MY ITDA" subtitle="함께하기로 한 일정과 나의 정보를 확인하세요."><CommunityArtwork variant="gathering" /><Card><Text style={common.title}>함께할 준비가 되었나요?</Text><Body muted>로그인하면 행사에 신청하고, 나의 신청 내역을 이곳에서 이어 볼 수 있어요.</Body><Button label="로그인하고 시작하기" onPress={() => router.push({ pathname: '/auth/sign-in', params: returnTo ? { returnTo } : {} })} /></Card><Button label="먼저 소식 둘러보기" variant="ghost" onPress={() => router.push('/events')} />{returnTo === '/account' && <FlaticonAttribution />}</Screen>;
  if (user.status !== 'active') return <Screen title={user.status === 'merged' ? '통합된 계정이에요' : '계정을 정리하고 있어요'}><EmptyState title={user.status === 'merged' ? '다시 로그인해 주세요' : '계정 삭제가 진행 중입니다'} description={user.status === 'merged' ? '연결된 로그인 수단으로 다시 로그인하면 통합된 신청 내역을 볼 수 있어요.' : '새로운 신청과 계정 변경은 할 수 없습니다.'} action={<Button label="로그아웃" busy={action.busy} onPress={() => void action.run(async () => { await signOut(); router.replace('/events'); })} />} />{action.error && <Notice danger>{action.error}</Notice>}</Screen>;
  return children;
}
