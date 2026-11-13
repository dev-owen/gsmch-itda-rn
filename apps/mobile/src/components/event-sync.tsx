import { useState } from 'react';
import { Linking } from 'react-native';
import { AppText as Text } from '@/components/app-text';
import type { EventItem, EventSyncStatus } from '@/domain/types';
import { api } from '@/services/api';
import { useAction } from '@/hooks/use-resource';
import { categoryLabel, formatEventRange } from '@/components/event-card';
import { Badge, Body, Button, Card, DetailRow, Divider, LoadingState, Notice, Row, common } from '@/components/ui';

function syncTime(value?: string | null) {
  if (!value) return '아직 기록이 없어요';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '시간 확인 중';
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}

function sourceWarningMessage(code: string) {
  const messages: Record<string, string> = {
    MISSING_PROMOTION_ID: '주보의 제목이 바뀌면 같은 행사인지 확인이 필요할 수 있어요.',
    MANUAL_CHANGES: '직접 수정한 내용이 있어 주보 변경을 자동으로 덮어쓰지 않았어요.',
    ACTIVE_REGISTRATIONS_REQUIRE_REVIEW: '이미 신청한 참가자가 있어요. 일정이나 참여 조건의 변경 내용을 확인해 주세요.',
    SOURCE_CONFLICTS_WITH_REGISTRATION_SETTINGS: '원문 일정과 현재 신청·취소 마감이 맞지 않아요. 일시와 접수 설정을 먼저 확인해 주세요.',
    AMBIGUOUS_EVENT_SCHEDULE: '원문에 여러 일정이 있어 행사 일시를 확정하지 못했어요. 실제 개최 일시를 확인해 주세요.',
    AMBIGUOUS_RECRUITMENT_WINDOW: '원문에 여러 기간이 있어 모집 기간을 확정하지 못했어요. 실제 모집 기간을 확인해 주세요.',
    NO_RECRUITMENT_WINDOW: '원문에서 모집 기간을 확인하지 못했어요. 모집 일정을 직접 확인해 주세요.',
    ONLY_REGISTRATION_WINDOW: '신청 기간만 확인되었어요. 신청 기간과 실제 행사 일시를 구분해 주세요.',
    NO_SCHEDULE: '원문에서 행사 일시를 확인하지 못했어요. 실제 일정을 직접 확인해 주세요.',
    SOURCE_REVIEW_REQUIRED: '원문에 확인이 필요한 내용이 있어 자동 반영을 보류했어요.',
    SOURCE_IDENTITY_CONFLICT: '같은 행사로 보이는 안내가 이미 있어요. 원문과 기존 행사를 확인해 주세요.',
  };
  return messages[code] || '원문 내용을 확인해 주세요.';
}

export function EventSyncStatusCard({ status, loading, error, busy, onRun, onRefresh }: {
  status?: EventSyncStatus; loading: boolean; error: string | null; busy: boolean; onRun: () => void; onRefresh: () => void;
}) {
  const run = status?.lastRun;
  return <Card>
    <Row between><Text style={common.title}>주보에서 일정 가져오기</Text><Badge label={busy ? '가져오는 중' : !status && error ? '상태 확인 필요' : run?.status === 'success' ? '최근 실행 성공' : run?.status === 'failed' ? '최근 실행 실패' : run?.status === 'skipped' ? '최근 실행 건너뜀' : '실행 기록 없음'} tone={run?.status === 'failed' ? 'red' : busy || run?.status === 'success' ? 'green' : 'muted'} /></Row>
    <Body muted>매주 월요일 오전 9시 · 한국 시간</Body>
    {loading && !status ? <LoadingState label="가져오기 기록을 확인하고 있어요" /> : status ? <><DetailRow label="최근 성공" value={syncTime(status.lastSuccessAt)} /><DetailRow label="최근 실행" value={run ? syncTime(run.finishedAt || run.startedAt) : '아직 실행하지 않았어요'} /></> : null}
    {run?.status === 'success' && <Row><Badge label={`새 일정 ${run.created}`} tone="muted" /><Badge label={`갱신 ${run.updated}`} tone="muted" /><Badge label={`확인 필요 ${run.pending}`} tone={run.pending ? 'gold' : 'muted'} /><Badge label={`원문 미확인 ${run.missing}`} tone={run.missing ? 'gold' : 'muted'} /></Row>}
    {run?.status === 'failed' && <Notice danger>최근 주보 가져오기를 완료하지 못했습니다. 연결 상태를 확인하고 다시 실행해 주세요.</Notice>}
    {run?.status === 'skipped' && <Notice>최근 가져오기는 건너뛰었습니다. 다른 실행이 진행 중일 수 있으니 실행 기록을 다시 확인해 주세요.</Notice>}
    {error && <Notice danger>{error}</Notice>}
    <Button label="지금 주보에서 가져오기" variant="secondary" busy={busy} disabled={loading && !status} onPress={onRun} />
    <Button label="실행 기록 새로 확인" variant="ghost" compact disabled={busy} onPress={onRefresh} />
    <Body muted>주보에서 빠진 일정도 자동으로 삭제하지 않습니다. 직접 관리 중인 내용과 기존 행사의 공개·취소 상태, 신청 설정은 유지합니다.</Body>
  </Card>;
}

export function EventSourceBadges({ event }: { event: EventItem }) {
  if (event.source?.kind !== 'bulletin') return null;
  return <Row><Badge label="주보에서 가져옴" tone="muted" /><Badge label={event.source.syncMode === 'automatic' ? '자동 갱신' : '직접 관리'} tone={event.source.syncMode === 'automatic' ? 'green' : 'gold'} />{event.source.pending && <Badge label="원문 확인 필요" tone="gold" />}{event.source.missing && <Badge label="원문 미확인" tone="gold" />}</Row>;
}

export function EventSourceControls({ event, dirty, onUpdated, onRefresh, onBusyChange }: {
  event: EventItem; dirty: boolean; onUpdated: (event: EventItem) => void; onRefresh: () => Promise<void>; onBusyChange?: (busy: boolean) => void;
}) {
  const action = useAction();
  const [showPreview, setShowPreview] = useState(false);
  const [confirmAutomatic, setConfirmAutomatic] = useState(false);
  const source = event.source;
  const refresh = () => void action.run(async () => { onBusyChange?.(true); try { await onRefresh(); } finally { onBusyChange?.(false); } });
  if (!source) return <Card><Badge label="연동 정보 확인 필요" tone="muted" /><Body muted>최신 관리 정보를 다시 불러와 주세요.</Body><Button label="관리 정보 다시 확인" variant="ghost" compact disabled={dirty} busy={action.busy} onPress={refresh} />{action.error && <Notice danger>{action.error}</Notice>}</Card>;
  if (source.kind !== 'bulletin') return <Card><Badge label="잇다에서 직접 등록" tone="muted" /><Body muted>이 일정은 잇다에서 직접 관리합니다. 주보 자동 가져오기로 내용이 바뀌지 않습니다.</Body></Card>;
  const latest = source.latest;
  const warningMessages = [...new Set(source.warnings.map(sourceWarningMessage))];
  const comparisons = latest ? [
    { label: '제목', current: event.title, latest: latest.title },
    { label: '설명', current: event.description, latest: latest.description },
    { label: '일정', current: formatEventRange(event), latest: formatEventRange(latest) },
    { label: '종류', current: categoryLabel(event.category), latest: categoryLabel(latest.category) },
    { label: '장소', current: event.location, latest: latest.location },
    { label: '대상', current: event.target, latest: latest.target },
  ] : [];
  const changeMode = (mode: 'manual' | 'automatic') => void action.run(async () => {
    if (dirty) throw new Error('수정 중인 내용을 먼저 저장하거나 취소해 주세요.');
    onBusyChange?.(true);
    try {
      const result = await api.setEventSyncMode(event.id, mode, event.version);
      onUpdated(result); setShowPreview(false); setConfirmAutomatic(false);
      action.setNotice(mode === 'automatic' ? '확인한 주보 내용을 반영하고 자동 갱신을 켰습니다.' : '직접 관리로 전환했습니다. 주보가 바뀌어도 이 내용을 자동으로 덮어쓰지 않습니다.');
    } finally { onBusyChange?.(false); }
  });
  return <Card>
    <EventSourceBadges event={event} />
    <DetailRow label="최근 확인" value={syncTime(source.lastSyncedAt)} />
    <Body muted>{source.syncMode === 'automatic' ? '주보의 제목·설명·행사 일시·장소 등이 바뀌면 자동으로 반영합니다.' : '현재 내용은 잇다에서 직접 관리합니다. 주보 변경은 자동으로 덮어쓰지 않습니다.'}</Body>
    {source.missing && <Notice>최근 주보에서 이 안내를 확인하지 못했습니다. 현재 일정과 신청 내역은 유지되며, 원문이 다시 나타나도 비공개·행사 취소 상태를 자동으로 복구하지 않습니다.</Notice>}
    {source.pending && <Notice>주보 내용이 바뀌었거나 확인이 필요한 항목이 있습니다. 최근 가져온 원문과 현재 내용을 비교해 주세요.</Notice>}
    {warningMessages.map(message => <Notice key={message}>{message}</Notice>)}
    {dirty && <Notice>수정 중인 내용을 먼저 저장하거나 취소한 뒤 관리 방식을 변경해 주세요.</Notice>}
    {source.url && <Button label="주보 원문 보기" variant="ghost" compact onPress={() => void action.run(async () => { if (!/^https?:\/\//i.test(source.url!)) throw new Error('원문 주소를 확인할 수 없습니다.'); await Linking.openURL(source.url!); })} />}
    <Button label="최근 가져온 원문과 비교" variant="secondary" disabled={!latest || action.busy} onPress={() => { setShowPreview(value => !value); setConfirmAutomatic(false); }} />
    <Button label="최신 상태 다시 불러오기" variant="ghost" compact disabled={dirty} busy={action.busy} onPress={refresh} />
    {showPreview && latest && <>
      <Divider /><Text style={common.title}>자동 갱신 전 내용 확인</Text>
      <Body muted>아래 주보 내용으로 제목·설명·일정·장소·대상을 반영합니다. 신청기간·성도 인증 조건·공개 범위와 행사 취소 상태는 그대로 유지합니다.</Body>
      {comparisons.map(item => <Card key={item.label}><Row between><Text style={common.title}>{item.label}</Text><Badge label={item.current === item.latest ? '같음' : '변경됨'} tone={item.current === item.latest ? 'muted' : 'gold'} /></Row><Text style={common.caption}>현재 잇다</Text><Body>{item.current || '입력 없음'}</Body><Divider /><Text style={common.caption}>최근 주보</Text><Body>{item.latest || '입력 없음'}</Body></Card>)}
      {source.missing && <Notice>원문이 확인되지 않는 동안에는 적용할 수 없습니다. 주보 가져오기를 다시 실행해 주세요.</Notice>}
      {confirmAutomatic ? <><Notice>이 내용으로 자동 갱신을 켤까요? 다음 주보 변경부터 원본 관리 항목이 자동으로 반영됩니다.</Notice><Button label="자동 갱신 재개 확정" busy={action.busy} disabled={dirty || source.missing} onPress={() => changeMode('automatic')} /><Button label="다시 비교하기" variant="ghost" disabled={action.busy} onPress={() => setConfirmAutomatic(false)} /></> : <Button label="주보 원문 적용하고 자동 갱신 켜기" disabled={dirty || source.missing || action.busy} onPress={() => setConfirmAutomatic(true)} />}
      {source.syncMode === 'manual' && <Button label="직접 관리 유지" variant="ghost" disabled={action.busy} onPress={() => { setShowPreview(false); setConfirmAutomatic(false); }} />}
    </>}
    {source.syncMode === 'automatic' && <Button label="직접 관리로 전환" variant="ghost" busy={action.busy} disabled={dirty} onPress={() => changeMode('manual')} />}
    {action.notice && <Notice>{action.notice}</Notice>}{action.error && <Notice danger>{action.error}</Notice>}
  </Card>;
}
