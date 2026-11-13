import { AppText as Text } from '@/components/app-text';
import { useCallback } from 'react';
import {  } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { api } from '@/services/api';
import { useSession } from '@/services/session';
import { useAction, useResource } from '@/hooks/use-resource';
import { useNow } from '@/hooks/use-now';
import { AccessGate } from '@/components/access-gate';
import { formatDate } from '@/components/event-card';
import { Badge, Body, Button, Card, DetailRow, EmptyState, ErrorState, LoadingState, Notice, Row, Screen, Section, common } from '@/components/ui';

export default function MergeScreen() { const { requestId } = useLocalSearchParams<{ requestId: string }>(); return <AccessGate returnTo={`/account/merge?requestId=${encodeURIComponent(requestId || '')}`}><MergeDetails requestId={requestId} /></AccessGate>; }
function MergeDetails({ requestId }: { requestId: string }) {
  const { signOut, user } = useSession();
  const action = useAction();
  const resource = useResource(useCallback(async () => { if (!requestId) throw new Error('계정 통합 요청을 찾을 수 없습니다. 로그인 수단 화면에서 다시 시작해 주세요.'); return api.getMerge(requestId); }, [requestId]), `${user?.id}:${user?.role}`);
  const now = useNow(1000);
  if (resource.loading && !resource.data) return <Screen back><LoadingState label="확인된 두 계정의 정보를 불러오고 있어요" /></Screen>;
  if (resource.error || !resource.data) return <Screen back title="계정 통합"><ErrorState message={resource.error || '통합 정보를 불러오지 못했습니다.'} onRetry={() => void resource.reload()} /></Screen>;
  const preview = resource.data;
  const expired = preview.status === 'expired' || new Date(preview.expiresAt).getTime() <= now;
  const blocked = !!preview.requiresAdminApproval || preview.conflicts.length > 0 || expired || preview.status === 'cancelled';
  const confirm = () => void action.run(async () => { await api.confirmMerge(preview); await signOut(); router.replace({ pathname: '/auth/sign-in', params: { merged: '1' } }); });
  const approve = () => void action.run(async () => { await api.approveMerge(preview); await resource.reload(); action.setNotice('관리자 승인을 반영했습니다. 갱신된 통합 결과를 다시 확인해 주세요.'); });
  const cancel = () => void action.run(async () => { await api.cancelMerge(requestId); router.replace('/account/login-methods'); });
  if (preview.status === 'completed') return <Screen back title="계정이 하나로 연결되었어요"><EmptyState title="통합이 완료되었습니다" description="다시 로그인하면 연결된 계정의 신청 내역을 확인할 수 있어요." action={<Button label="다시 로그인하기" onPress={() => void action.run(async () => { await signOut(); router.replace('/auth/sign-in'); })} />} /></Screen>;
  return <Screen back eyebrow="ACCOUNT MERGE" title="하나의 계정으로 모을까요?" subtitle="아래 결과를 확인한 뒤 통합을 확정해 주세요.">
    <Badge label="양쪽 계정 확인 완료" />
    <Card><DetailRow label="유지 계정" value={preview.targetUser.name} /><DetailRow label="합칠 계정" value={preview.sourceUser.name} /><DetailRow label="로그인" value={preview.methods.map(item => item.provider === 'kakao' ? '카카오' : item.provider === 'google' ? 'Google' : item.provider).join(' · ')} /><DetailRow label="성도 인증" value={preview.isMemberVerified ? '인증 상태 유지' : '미인증'} /><DetailRow label="확인 기한" value={formatDate(preview.expiresAt)} /></Card>
    <Row><Card style={common.grow}><Text style={common.largeValue}>{preview.registrationCount}</Text><Body muted>통합할 신청 내역</Body></Card><Card style={common.grow}><Text style={common.largeValue}>{preview.duplicateCount}</Text><Body muted>같은 행사 중복</Body></Card></Row>
    {preview.registrations && preview.registrations.length > 0 && <Section title="통합 후 신청 결과">{preview.registrations.map(item => <Card key={item.id}><Text style={common.title}>{item.event?.title || '행사 신청'}</Text><Body>{item.participantName} · {item.status === 'confirmed' ? '신청 확정' : '신청 취소'}</Body><Body muted>{item.attendanceStatus === 'present' ? '출석 확인' : item.attendanceStatus === 'absent' ? '불참 처리' : '출석 미확인'}</Body></Card>)}</Section>}
    {preview.requiresAdminApproval && <><Notice danger>관리자 계정이 포함된 통합은 별도 승인이 필요합니다. 승인 후에도 갱신된 결과를 확인하고 통합을 확정해야 합니다.</Notice>{user?.role === 'admin' ? <Button label="관리자 계정 통합 승인" variant="secondary" busy={action.busy} disabled={expired} onPress={approve} /> : <Body muted>관리자에게 통합 승인을 요청해 주세요.</Body>}</>}
    {preview.conflicts.map((conflict, index) => <Notice danger key={`${conflict.code}-${index}`}>{conflict.title ? `${conflict.title}: ` : ''}{conflict.message}</Notice>)}
    {expired && <Notice danger>확인 기한이 지났습니다. 계정을 다시 확인한 뒤 통합해 주세요.</Notice>}
    {preview.status === 'cancelled' && <Notice>취소된 통합 요청입니다.</Notice>}
    <Body muted>최종 확인이 성공하기 전에는 기존 계정과 신청 내역을 변경하지 않습니다. 통합 완료 후 다시 로그인하게 됩니다.</Body>
    {action.error && <Notice danger>{action.error}</Notice>}{action.notice && <Notice>{action.notice}</Notice>}
    <Button label="이 결과로 통합 확정" busy={action.busy} disabled={blocked} onPress={confirm} /><Button label="통합하지 않고 돌아가기" variant="ghost" disabled={action.busy} onPress={cancel} />
  </Screen>;
}
