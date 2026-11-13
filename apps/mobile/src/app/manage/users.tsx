import { AppText as Text } from '@/components/app-text';
import { useCallback, useState } from 'react';
import {  } from 'react-native';
import { api } from '@/services/api';
import type { AppUser } from '@/domain/types';
import { useAction, useResource } from '@/hooks/use-resource';
import { AccessGate } from '@/components/access-gate';
import { Badge, Body, Button, Card, Chip, EmptyState, ErrorState, Field, LoadingState, Notice, Row, Screen, common } from '@/components/ui';

export default function ManageUsersScreen() { return <AccessGate admin returnTo="/manage/users"><ManageUsers /></AccessGate>; }
function ManageUsers() {
  const resource = useResource(useCallback(() => api.listAdminUsers(), []));
  const action = useAction();
  const [query, setQuery] = useState('');
  const [pendingOnly, setPendingOnly] = useState(true);
  const [revoke, setRevoke] = useState<string | null>(null);
  const users = (resource.data || []).filter(user => user.status === 'active' && (!pendingOnly || (!user.isMemberVerified && !!user.verificationRequestedAt)) && user.name.toLowerCase().includes(query.trim().toLowerCase()));
  const verify = (user: AppUser, verified: boolean) => void action.run(async () => { await api.verifyUser(user.id, verified, user.version); setRevoke(null); await resource.reload(); action.setNotice(`${user.name} 님의 성도 인증을 ${verified ? '완료' : '해제'}했습니다.`); });
  return <Screen back eyebrow="MEMBER VERIFICATION" title="성도 인증 관리" subtitle="요청자의 이름과 교회 소속을 확인한 뒤 처리해 주세요." onRefresh={() => void resource.reload()} refreshing={resource.loading && !!resource.data}>
    <Field label="이름으로 찾기" value={query} onChangeText={setQuery} placeholder="인증 요청자 이름" /><Row><Chip label="확인할 요청" selected={pendingOnly} onPress={() => setPendingOnly(true)} /><Chip label="전체 사용자" selected={!pendingOnly} onPress={() => setPendingOnly(false)} /></Row>
    {action.notice && <Notice>{action.notice}</Notice>}{action.error && <Notice danger>{action.error}</Notice>}
    {resource.loading && !resource.data ? <LoadingState /> : resource.error ? <ErrorState message={resource.error} onRetry={() => void resource.reload()} /> : users.length ? users.map(user => <Card key={user.id}><Row between><Text style={common.title}>{user.name || '이름 미입력'}</Text><Badge label={user.isMemberVerified ? '인증 완료' : user.verificationRequestedAt ? '확인 요청' : '미인증'} tone={user.isMemberVerified ? 'green' : 'gold'} /></Row>{user.role === 'admin' && <Body muted>관리자 계정</Body>}{user.isMemberVerified ? revoke === user.id ? <><Notice danger>성도 인증을 해제하면 성도 대상 행사 접근과 새 신청이 제한됩니다.</Notice><Button label="인증 해제 확정" variant="danger" busy={action.busy} onPress={() => verify(user, false)} /><Button label="돌아가기" variant="ghost" onPress={() => setRevoke(null)} /></> : <Button label="성도 인증 해제" variant="ghost" compact disabled={action.busy} onPress={() => setRevoke(user.id)} /> : <Button label="성도 확인 · 인증 완료" variant="secondary" busy={action.busy} onPress={() => verify(user, true)} />}</Card>) : <EmptyState title="확인할 사용자가 없어요" description="새 요청이 들어오면 이곳에서 확인할 수 있어요." />}
  </Screen>;
}
