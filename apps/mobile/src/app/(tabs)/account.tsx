import { AppText as Text } from '@/components/app-text';
import { useState } from 'react';
import { View } from 'react-native';
import { AppIcon } from '@/components/app-icon';
import { palette } from '@/theme/tokens';
import { router } from 'expo-router';
import { api } from '@/services/api';
import { useSession } from '@/services/session';
import { useAction } from '@/hooks/use-resource';
import { AccessGate } from '@/components/access-gate';
import { ProfileEditor } from '@/components/profile-editor';
import { FlaticonAttribution } from '@/components/flaticon-attribution';
import { Badge, Body, Button, Card, Divider, Field, Notice, Row, Screen, Section, common } from '@/components/ui';

export default function AccountScreen() { const { user } = useSession(); return <AccessGate returnTo="/account"><AccountDetails key={user?.id} /></AccessGate>; }
function AccountDetails() {
  const { user, refresh, signOut } = useSession();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteWord, setDeleteWord] = useState('');
  const action = useAction();
  const verify = () => void action.run(async () => { await api.requestMemberVerification(); await refresh(); action.setNotice('성도 인증을 요청했습니다. 관리자가 확인하면 계정에 반영됩니다.'); });
  const logout = () => void action.run(async () => { await signOut(); router.replace('/events'); });
  const remove = () => void action.run(async () => { await api.deleteAccount(); await signOut(); router.replace('/auth/sign-in'); });
  return <Screen eyebrow="MY ACCOUNT" title={`${user?.name || '반가운'}님`} subtitle="함께할 이름과 계정을 관리해요." right={<View style={{ width: 58, height: 58, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.sage }}><AppIcon name="user" size={26} /></View>}>
    <Row><Badge label={user?.isMemberVerified ? '성도 인증 완료' : user?.verificationRequestedAt ? '성도 인증 확인 중' : '성도 미인증'} tone={user?.isMemberVerified ? 'green' : 'gold'} />{user?.role === 'admin' && <Badge label="관리자" />}</Row>
    <Section title="내 정보">{user && <ProfileEditor key={`${user.id}:${user.name}:${user.peerGroup}:${user.gender}:${user.phoneNumber}`} user={user} onSaved={refresh} />}</Section>
    <Section title="성도 인증"><Card><Body>{user?.isMemberVerified ? '성도 인증이 완료되었어요. 성도 대상 행사도 신청할 수 있습니다.' : user?.verificationRequestedAt ? '관리자가 요청을 확인하고 있어요. 아래에서 상태를 새로 확인할 수 있습니다.' : '성도 대상 행사에 참여하려면 인증을 요청해 주세요. 일반 공개 행사에는 인증 없이도 신청할 수 있어요.'}</Body>{!user?.isMemberVerified && !user?.verificationRequestedAt && <Button label="성도 인증 요청" variant="secondary" busy={action.busy} onPress={verify} />}<Button label="인증 상태 새로 확인" variant="ghost" busy={action.busy} onPress={() => void action.run(async () => { await refresh(); })} /></Card></Section>
    <Section title="로그인과 계정"><Card><Button label="Google · 카카오 연결 관리" variant="ghost" onPress={() => router.push('/account/login-methods')} /><Body muted>로그인 수단을 추가하거나, 따로 가입한 계정을 하나로 합칠 수 있어요.</Body></Card></Section>
    {user?.role === 'admin' && <Section title="교회 행사 운영"><Card><Body muted>행사와 회원 관리는 웹 관리자 대시보드에서 승인된 Google 계정으로 로그인해 주세요.</Body></Card></Section>}
    {action.notice && <Notice>{action.notice}</Notice>}{action.error && <Notice danger>{action.error}</Notice>}
    <Section title="서비스 안내"><Body muted>선한목자 젊은이교회의 행사 정보를 모아 제공하는 개인 프로젝트입니다. 개인정보는 계정 확인과 행사 신청·출석 관리에 사용하며, 다른 참가자에게 공개하지 않습니다.</Body><FlaticonAttribution /></Section>
    <Button label="로그아웃" variant="ghost" busy={action.busy} onPress={logout} /><Divider />
    {confirmDelete ? <Card><Text style={common.title}>계정을 삭제할까요?</Text><Body>계정과 로그인 연결을 삭제하고 진행 중인 신청을 취소합니다. 이 작업은 되돌릴 수 없습니다.</Body><Field label="삭제를 원하면 ‘탈퇴’를 입력해 주세요" value={deleteWord} onChangeText={setDeleteWord} /><Button label="계정 삭제 요청" variant="danger" disabled={deleteWord !== '탈퇴'} busy={action.busy} onPress={remove} /><Button label="돌아가기" variant="ghost" disabled={action.busy} onPress={() => setConfirmDelete(false)} /></Card> : <Button label="계정 삭제" variant="ghost" onPress={() => setConfirmDelete(true)} />}
  </Screen>;
}
