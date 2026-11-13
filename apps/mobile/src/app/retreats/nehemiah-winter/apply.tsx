import { useCallback } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { AppText as Text } from '@/components/app-text';
import type { Gender, Provider, RetreatDetail, RetreatRegistrationInput } from '@/domain/types';
import { api } from '@/services/api';
import { useSession } from '@/services/session';
import { useAction, useResource } from '@/hooks/use-resource';
import { useNow } from '@/hooks/use-now';
import { useRetreatDraft, retreatSessionScope, type RetreatDraft } from '@/components/retreat-draft';
import { DepartureSummary, genderLabel, RetreatChoice } from '@/components/retreat-ui';
import { eventStatus, formatDate, formatEventRange } from '@/components/event-card';
import { Badge, Body, Button, Card, DetailRow, EmptyState, ErrorState, Field, LoadingState, Notice, Row, Screen, Section, common } from '@/components/ui';

function validate(draft: RetreatDraft, camp: RetreatDetail): Omit<RetreatRegistrationInput, 'expectedEventVersion' | 'expectedRegistrationVersion'> {
  const participantName = draft.participantName.trim(); const peerGroup = draft.peerGroup.trim();
  const phoneNumber = draft.phoneNumber.replace(/[\s().\-]/g, '');
  const departure = camp.departureOptions.find(item => item.id === draft.departureOption);
  const needsNote = departure?.requiresNote || draft.departureOption === 'car' || draft.departureOption === 'other';
  if (!participantName || participantName.length > 50) throw new Error('참가 이름을 1~50자로 입력해 주세요.');
  if (!peerGroup || peerGroup.length > 30) throw new Error('또래를 1~30자로 입력해 주세요.');
  if (!draft.gender) throw new Error('성별을 선택해 주세요.');
  if (!/^\+?\d{8,15}$/.test(phoneNumber)) throw new Error('연락 가능한 전화번호를 입력해 주세요. 숫자 8~15자리와 앞의 + 기호를 사용할 수 있어요.');
  if (!departure) throw new Error('출발 방식을 선택해 주세요.');
  if (needsNote && !draft.departureNote.trim()) throw new Error('출발 시각과 이동 메모를 입력해 주세요.');
  if (draft.departureNote.length > 200) throw new Error('출발 메모는 200자 이내로 입력해 주세요.');
  if (draft.prayerRequest.length > 2000) throw new Error('기도제목은 2,000자 이내로 입력해 주세요.');
  return { participantName, peerGroup, gender: draft.gender, phoneNumber, departureOption: draft.departureOption, departureNote: needsNote ? draft.departureNote.trim() : null, prayerRequest: draft.prayerRequest.trim() || null };
}

export default function RetreatApplyScreen() {
  const { user, loading: sessionLoading, signIn, refresh } = useSession();
  const flow = useRetreatDraft();
  const action = useAction();
  const loggedIn = !!user;
  const scope = retreatSessionScope(user);
  const resource = useResource(useCallback(async () => {
    const [camp, registration] = await Promise.all([api.getRetreat(), loggedIn ? api.getMyRetreatRegistration() : Promise.resolve(null)]);
    return { camp, registration };
  }, [loggedIn]), scope);
  const now = useNow();
  if (sessionLoading || resource.loading && !resource.data) return <Screen back title="느동수 신청"><LoadingState label="신청서 정보를 준비하고 있어요" /></Screen>;
  if (resource.error || !resource.data) return <Screen back title="느동수 신청"><ErrorState message={resource.error || '신청서를 불러오지 못했습니다.'} onRetry={() => void resource.reload()} /></Screen>;
  const { camp, registration } = resource.data;
  if (registration?.status === 'confirmed') return <Screen back eyebrow="NEHEMIAH WINTER RETREAT" title="이미 접수하셨어요"><EmptyState title="기존 접수 내역을 확인해 주세요" description="같은 계정으로 중복 접수하지 않습니다." action={<Button label="내 느동수 접수 확인" onPress={() => router.replace('/retreats/nehemiah-winter/confirmation')} />} /></Screen>;
  const { draft, locked } = flow;
  const departure = camp.departureOptions.find(option => option.id === draft.departureOption);
  const needsNote = departure?.requiresNote || draft.departureOption === 'car' || draft.departureOption === 'other';
  const status = eventStatus(camp.event, now);
  const reviewed = flow.reviewed && flow.reviewedEventVersion === camp.event.version;
  const review = () => void action.run(async () => { validate(draft, camp); flow.setView('review'); });
  const login = (provider: Provider) => void action.run(async () => {
    flow.beginGuestLogin();
    try { await signIn(provider, '/retreats/nehemiah-winter/apply'); }
    catch (error) { flow.cancelGuestLogin(); throw error; }
  });
  const submit = () => void action.run(async () => {
    if (!user) throw new Error('최종 접수하려면 로그인해 주세요.');
    if (!reviewed) throw new Error('현재 신청 내용을 확인한 뒤 확인란을 선택해 주세요.');
    const input = validate(draft, camp);
    let result;
    try { result = await api.registerRetreat({ ...input, expectedEventVersion: camp.event.version, expectedRegistrationVersion: registration?.version || 0 }); }
    catch (error) { await resource.reload(); throw error; }
    if (result.status !== 'confirmed') throw new Error('접수 결과를 확인하지 못했습니다. 내 신청 내역을 다시 확인해 주세요.');
    flow.clear(); await refresh(); router.replace('/retreats/nehemiah-winter/confirmation');
  });
  return <Screen back eyebrow={flow.view === 'review' ? 'REVIEW YOUR APPLICATION' : 'NEHEMIAH WINTER RETREAT'} title={flow.view === 'review' ? '한 번 더 확인해 주세요' : `${camp.shortName} 신청서`} subtitle={flow.view === 'review' ? '함께할 이름과 출발 방식을 확인해 주세요.' : '함께할 마음을 차근차근 적어 주세요.'}>
    {camp.isDemo && <Notice>가상 행사 신청서입니다. 예시 수련회의 기능을 확인하기 위한 접수입니다.</Notice>}
    <Card><Text style={common.title}>{camp.title}</Text><Body muted>{formatEventRange({ startsAt: camp.startsAt, endsAt: camp.endsAt, allDay: false })}</Body><Badge label={status.label} tone={status.tone} /></Card>
    {flow.view === 'edit' ? <>
      {Object.values(locked).some(Boolean) && <Notice>계정에 등록된 기본 정보는 미리 입력되며 수정할 수 없어요. 바꾸려면 내 계정에서 먼저 변경해 주세요.</Notice>}
      <Section title="참가자 정보"><Card><Field label={`참가 이름${locked.participantName ? ' · 등록 정보' : ''}`} value={draft.participantName} onChangeText={participantName => flow.update({ participantName })} editable={!locked.participantName && !action.busy} maxLength={50} autoComplete="name" placeholder="실제 참가 이름" /><Field label={`또래${locked.peerGroup ? ' · 등록 정보' : ''}`} value={draft.peerGroup} onChangeText={peerGroup => flow.update({ peerGroup })} editable={!locked.peerGroup && !action.busy} maxLength={30} placeholder="예: 98또래" /><Body>성별{locked.gender ? ' · 등록 정보' : ''}</Body><View accessibilityRole="radiogroup" style={common.gap}>{(['male', 'female', 'other'] as Gender[]).map(gender => <RetreatChoice key={gender} label={genderLabel(gender)} selected={draft.gender === gender} disabled={locked.gender || action.busy} onPress={() => flow.update({ gender })} />)}</View><Field label={`연락처${locked.phoneNumber ? ' · 등록 정보' : ''}`} value={draft.phoneNumber} onChangeText={phoneNumber => flow.update({ phoneNumber })} editable={!locked.phoneNumber && !action.busy} maxLength={30} keyboardType="phone-pad" autoComplete="tel" placeholder="010-0000-0000" help="현장 안내가 필요할 때 연락할 수 있는 번호를 적어 주세요." /></Card></Section>
      <Section title="어떻게 출발하시나요?"><View accessibilityRole="radiogroup" style={common.gap}>{camp.departureOptions.map(option => <RetreatChoice key={option.id} label={option.label} description={[option.description, option.departureAt ? `출발: ${formatDate(option.departureAt)}` : null].filter(Boolean).join('\n')} selected={draft.departureOption === option.id} disabled={action.busy} onPress={() => flow.update({ departureOption: option.id })} />)}</View>{needsNote && <Field label="출발 시각과 이동 메모 · 필수" value={draft.departureNote} onChangeText={departureNote => flow.update({ departureNote })} editable={!action.busy} maxLength={200} multiline placeholder="언제 출발하고 어떻게 이동할지 알려주세요." />}{!needsNote && departure?.departureAt && <Notice>선택하신 {departure.label}의 출발 시각은 {formatDate(departure.departureAt)}입니다.</Notice>}</Section>
      <Section title="함께 기도해요"><Field label="기도제목 · 선택" value={draft.prayerRequest} onChangeText={prayerRequest => flow.update({ prayerRequest })} editable={!action.busy} maxLength={2000} multiline placeholder="수련회를 준비하며 함께 나누고 싶은 기도제목을 적어 주세요." help={`${draft.prayerRequest.length.toLocaleString()} / 2,000자 · 다른 참가자에게 공개하지 않습니다.`} /></Section>
      <Body muted>연락처와 기도제목은 이 화면의 메모리에만 임시로 보관합니다. 최종 접수 전에는 서버에 저장하지 않으며 앱을 닫으면 작성 내용이 사라질 수 있어요.</Body>
      <Body muted>최종 접수하면 새로 입력한 기본 정보는 내 정보에 저장되어 다음 신청에 사용됩니다.</Body>
      {action.error && <Notice danger>{action.error}</Notice>}<Button label="신청 내용 검토하기" busy={action.busy} onPress={review} />
    </> : <>
      <Card><DetailRow label="이름" value={draft.participantName} /><DetailRow label="또래" value={draft.peerGroup} /><DetailRow label="성별" value={genderLabel(draft.gender)} /><DetailRow label="연락처" value={draft.phoneNumber} /><DepartureSummary camp={camp} option={draft.departureOption} note={needsNote ? draft.departureNote : null} /></Card>
      <Section title="기도제목"><Card><Body>{draft.prayerRequest.trim() || '작성하지 않았어요.'}</Body></Card></Section>
      <Body muted>새로 입력한 기본 정보는 최종 접수 후 내 정보에 저장되어 다음 신청에 사용됩니다.</Body>
      {user && <Notice>로그인한 계정의 등록 정보가 반영되어 있어요. 최종 접수 전에 내용을 다시 확인해 주세요.</Notice>}
      {flow.reviewed && !reviewed && <Notice>행사 정보가 변경되었어요. 현재 내용을 다시 확인해 주세요.</Notice>}
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: reviewed, disabled: action.busy }} disabled={action.busy} onPress={() => flow.setReviewed(!reviewed, camp.event.version)}><Card><Row between><View style={common.grow}><Body>신청 내용을 확인했습니다.</Body><Body muted>이 정보는 수련회 신청·출석과 현장 안내, 기도제목 전달에 사용됩니다.</Body></View><Badge label={reviewed ? '확인 완료' : '확인하기'} tone={reviewed ? 'green' : 'gold'} /></Row></Card></Pressable>
      {action.error && <Notice danger>{action.error}</Notice>}
      {!status.canApply && <Notice>현재 {status.label} 상태입니다. 신청서는 살펴볼 수 있지만 최종 접수는 할 수 없어요.</Notice>}
      {user ? <Button label="느동수 최종 접수하기" busy={action.busy} disabled={!reviewed || !status.canApply} onPress={submit} /> : <Card><Text style={common.title}>최종 접수만 로그인해 주세요</Text><Body muted>‘계속하기’를 누르면 지금 작성한 내용은 메모리에만 두고 로그인 후 이어갑니다. 로그인한 계정의 등록 정보가 다르면 그 정보로 다시 확인하게 됩니다.</Body><Button label="카카오로 로그인하고 이어가기" variant="kakao" busy={action.busy} disabled={!reviewed || !status.canApply} onPress={() => login('kakao')} /><Button label="Google로 로그인하고 이어가기" variant="ghost" busy={action.busy} disabled={!reviewed || !status.canApply} onPress={() => login('google')} /></Card>}
      <Button label="신청 내용 수정하기" variant="ghost" disabled={action.busy} onPress={() => flow.setView('edit')} />
    </>}
    <Button label="수련회 안내 다시 보기" variant="ghost" disabled={action.busy} onPress={() => router.push('/dongsu')} />
  </Screen>;
}
