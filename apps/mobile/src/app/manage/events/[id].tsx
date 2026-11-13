import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import { Switch, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import type { EventInput, EventItem } from '@/domain/types';
import { api } from '@/services/api';
import { useAction, useResource } from '@/hooks/use-resource';
import { AccessGate } from '@/components/access-gate';
import { EventSourcePicker, type EventSourceOption } from '@/components/event-source-picker';
import { EventSourceControls } from '@/components/event-sync';
import { Body, Button, Card, Chip, ErrorState, Field, LoadingState, Notice, Row, Screen, Section, common } from '@/components/ui';
import { palette } from '@/theme/tokens';

const emptyEvent: EventInput = { title: '', category: 'event', description: '', memberDetails: '', location: '', target: '', startsAt: null, endsAt: null, allDay: false, visibility: 'public', requiresMemberVerification: false, publicationStatus: 'draft', lifecycleStatus: 'active', registrationEnabled: false, registrationOpensAt: null, registrationClosesAt: null, cancellationClosesAt: null, sourceUrl: null };
function editableDate(value?: string | null) {
  if (!value) return '';
  const date = new Date(value); if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const get = (type: string) => parts.find(part => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}
function parseDate(value: string, label: string): string | null {
  if (!value.trim()) return null;
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value.trim())) throw new Error(`${label}은 2026-11-15 15:00 형식으로 입력해 주세요.`);
  const date = new Date(`${value.trim().replace(' ', 'T')}:00+09:00`);
  if (Number.isNaN(date.getTime()) || editableDate(date.toISOString()) !== value.trim()) throw new Error(`${label}의 날짜와 시간을 확인해 주세요.`);
  return date.toISOString();
}
function Toggle({ label, description, value, onChange }: { label: string; description?: string; value: boolean; onChange: (value: boolean) => void }) { return <Row between><View style={common.grow}><Body>{label}</Body>{description && <Body muted>{description}</Body>}</View><Switch accessibilityLabel={label} value={value} onValueChange={onChange} trackColor={{ false: palette.border, true: palette.forest }} thumbColor={palette.white} /></Row>; }

export default function ManageEventScreen() { const { id } = useLocalSearchParams<{ id: string }>(); return <AccessGate admin returnTo={`/manage/events/${id}`}><ManageEventLoader id={id} /></AccessGate>; }
function ManageEventLoader({ id }: { id: string }) {
  const isNew = id === 'new';
  const resource = useResource(useCallback(async () => { if (isNew) return null; const event = (await api.listAdminEvents()).find(item => item.id === id); if (!event) throw new Error('관리할 행사를 찾을 수 없습니다.'); return event; }, [id, isNew]));
  if (resource.loading) return <Screen back><LoadingState /></Screen>;
  if (resource.error) return <Screen back title="행사 설정"><ErrorState message={resource.error} onRetry={() => void resource.reload()} /></Screen>;
  return <ManageEventForm key={`${id}:${resource.data?.version || 0}`} id={id} original={resource.data || null} />;
}
function ManageEventForm({ id, original }: { id: string; original: EventItem | null }) {
  const isNew = id === 'new';
  const [savedEvent, setSavedEvent] = useState(original);
  const [dirty, setDirty] = useState(false);
  const [sourceBusy, setSourceBusy] = useState(false);
  const [form, setFormState] = useState<EventInput>(() => original ? { ...original, expectedVersion: original.version } : { ...emptyEvent });
  const [dates, setDatesState] = useState(() => ({ start: editableDate(original?.startsAt), end: editableDate(original?.endsAt), opens: editableDate(original?.registrationOpensAt), closes: editableDate(original?.registrationClosesAt), cancel: editableDate(original?.cancellationClosesAt) }));
  const action = useAction();
  const locked = sourceBusy || action.busy;
  const setForm: Dispatch<SetStateAction<EventInput>> = value => { if (!locked) { setDirty(true); setFormState(value); } };
  const setDates: Dispatch<SetStateAction<typeof dates>> = value => { if (!locked) { setDirty(true); setDatesState(value); } };
  const applySavedEvent = (event: EventItem) => {
    setSavedEvent(event); setDirty(false); setFormState({ ...event, expectedVersion: event.version });
    setDatesState({ start: editableDate(event.startsAt), end: editableDate(event.endsAt), opens: editableDate(event.registrationOpensAt), closes: editableDate(event.registrationClosesAt), cancel: editableDate(event.cancellationClosesAt) });
  };
  const reloadSavedEvent = async () => { const event = (await api.listAdminEvents()).find(item => item.id === id); if (!event) throw new Error('행사를 찾을 수 없습니다. 목록에서 다시 확인해 주세요.'); applySavedEvent(event); };
  const sourceChanged = !!savedEvent && (form.title !== savedEvent.title || form.description !== savedEvent.description || form.category !== savedEvent.category || form.location !== savedEvent.location || form.target !== savedEvent.target || form.allDay !== savedEvent.allDay || dates.start !== editableDate(savedEvent.startsAt) || dates.end !== editableDate(savedEvent.endsAt));
  const selectSource = (source: EventSourceOption) => setForm(current => ({ ...current, sourcePromotionId: source.id, sourceBulletinId: source.bulletinId, sourceUrl: source.url, ...(isNew ? { title: source.title, description: source.body } : {}) }));
  const save = () => void action.run(async () => {
    if (!form.title.trim()) throw new Error('행사 제목을 입력해 주세요.');
    const input: EventInput = { ...form, title: form.title.trim(), startsAt: parseDate(dates.start, '행사 시작'), endsAt: parseDate(dates.end, '행사 종료'), registrationOpensAt: parseDate(dates.opens, '접수 시작'), registrationClosesAt: parseDate(dates.closes, '접수 마감'), cancellationClosesAt: parseDate(dates.cancel, '취소 마감') };
    if (input.registrationEnabled && !input.registrationClosesAt) throw new Error('신청을 받는 행사는 접수 마감을 입력해 주세요.');
    const result = await api.saveEvent(input);
    if (isNew) router.replace({ pathname: '/manage/events/[id]', params: { id: result.id } });
    else { applySavedEvent(result); action.setNotice('행사 정보를 저장했습니다.'); }
  });
  return <Screen back eyebrow="EVENT SETTINGS" title={isNew ? '새 행사 등록' : '행사 설정'} subtitle="변경 내용을 확인한 뒤 저장해 주세요.">
    {savedEvent && <Section title="원문과 관리 방식"><EventSourceControls event={savedEvent} dirty={dirty || action.busy} onUpdated={applySavedEvent} onRefresh={reloadSavedEvent} onBusyChange={setSourceBusy} /></Section>}
    {sourceBusy && <Notice>원문과 관리 방식을 반영하고 있어요. 잠시만 기다려 주세요.</Notice>}
    <Section title="기존 주보 연결"><EventSourcePicker selectedId={form.sourcePromotionId} selectedLabel={form.title} onSelect={selectSource} onClear={() => setForm(current => ({ ...current, sourcePromotionId: null, sourceBulletinId: null, sourceUrl: null }))} /><Body muted>{isNew ? '새 행사는 선택한 주보의 제목과 설명으로 채워집니다. ' : ''}행사 일시와 신청기간은 원문을 확인하고 직접 입력해 주세요.</Body></Section>
    <Section title="기본 안내"><Card><Field label="행사 제목" value={form.title} onChangeText={title => setForm(current => ({ ...current, title }))} /><Body>종류</Body><View style={common.rowWrap}><Chip label="행사" selected={form.category === 'event'} onPress={() => setForm(current => ({ ...current, category: 'event' }))} /><Chip label="모집" selected={form.category === 'recruitment'} onPress={() => setForm(current => ({ ...current, category: 'recruitment' }))} /></View><Field label="대상" value={form.target} onChangeText={target => setForm(current => ({ ...current, target }))} /><Field label="장소" value={form.location} onChangeText={location => setForm(current => ({ ...current, location }))} /><Field label="공개 설명" multiline value={form.description} onChangeText={description => setForm(current => ({ ...current, description }))} /><Field label="로그인 후 추가 안내" multiline value={form.memberDetails || ''} onChangeText={memberDetails => setForm(current => ({ ...current, memberDetails }))} /></Card></Section>
    <Section title="행사 일정"><Card><Field label="시작 일시 · 한국 시간" value={dates.start} placeholder="2026-11-15 15:00" onChangeText={start => setDates(current => ({ ...current, start }))} help="일정이 미정이면 비워둘 수 있어요." /><Field label="종료 일시 · 한국 시간" value={dates.end} placeholder="2026-11-15 18:00" onChangeText={end => setDates(current => ({ ...current, end }))} /><Toggle label="종일 일정" value={form.allDay} onChange={allDay => setForm(current => ({ ...current, allDay }))} /></Card></Section>
    <Section title="공개 범위와 신청"><Card><Body>일정 공개 범위</Body><View style={common.rowWrap}><Chip label="누구나 확인" selected={form.visibility === 'public'} onPress={() => setForm(current => ({ ...current, visibility: 'public' }))} /><Chip label="성도 인증 후 확인" selected={form.visibility === 'members'} onPress={() => setForm(current => ({ ...current, visibility: 'members' }))} /></View><Toggle label="앱에서 신청 받기" value={form.registrationEnabled} onChange={registrationEnabled => setForm(current => ({ ...current, registrationEnabled }))} /><Toggle label="신청 시 성도 인증 필요" description="일정 공개 범위와 별도로 적용됩니다." value={form.requiresMemberVerification} onChange={requiresMemberVerification => setForm(current => ({ ...current, requiresMemberVerification }))} />{form.registrationEnabled && <><Field label="접수 시작 · 한국 시간" value={dates.opens} placeholder="2026-11-01 09:00" onChangeText={opens => setDates(current => ({ ...current, opens }))} /><Field label="접수 마감 · 한국 시간" value={dates.closes} placeholder="2026-11-14 23:59" onChangeText={closes => setDates(current => ({ ...current, closes }))} /><Field label="개인 취소 마감 · 한국 시간" value={dates.cancel} placeholder="2026-11-15 15:00" onChangeText={cancel => setDates(current => ({ ...current, cancel }))} /><Notice>정원 제한 없이 신청 즉시 확정됩니다.</Notice></>}</Card></Section>
    <Section title="게시 상태"><Card><View style={common.rowWrap}>{([{ key: 'draft', label: '작성 중' }, { key: 'published', label: '게시' }, { key: 'hidden', label: '비공개' }] as const).map(item => <Chip key={item.key} label={item.label} selected={form.publicationStatus === item.key} onPress={() => setForm(current => ({ ...current, publicationStatus: item.key }))} />)}</View><Body>행사 진행 상태</Body><View style={common.rowWrap}>{([{ key: 'active', label: '진행 예정' }, { key: 'completed', label: '종료' }, { key: 'cancelled', label: '행사 취소' }] as const).map(item => <Chip key={item.key} label={item.label} selected={form.lifecycleStatus === item.key} onPress={() => setForm(current => ({ ...current, lifecycleStatus: item.key }))} />)}</View>{form.lifecycleStatus === 'cancelled' && <Notice danger>저장하면 새 신청과 출석 처리가 차단됩니다. 기존 신청자는 행사 취소 상태를 확인하게 됩니다.</Notice>}</Card></Section>
    {action.error && <Notice danger>{action.error}</Notice>}{action.notice && <Notice>{action.notice}</Notice>}
    {savedEvent?.source?.kind === 'bulletin' && savedEvent.source.syncMode === 'automatic' && sourceChanged && <Notice>주보에서 관리하던 제목·설명·일시·장소 등을 직접 수정했습니다. 저장하면 직접 관리로 전환되어 주보 변경으로 덮어쓰지 않습니다. 신청·공개 설정만 바꾸면 자동 갱신은 유지됩니다.</Notice>}
    <Button label="행사 정보 저장" busy={action.busy} disabled={sourceBusy} onPress={save} />{dirty && savedEvent && <Button label="수정 내용 취소" variant="ghost" disabled={locked} onPress={() => applySavedEvent(savedEvent)} />}{!isNew && <Button label="신청자 · 출석 관리" variant="secondary" onPress={() => router.push({ pathname: '/manage/events/[id]/roster', params: { id } })} />}
  </Screen>;
}
