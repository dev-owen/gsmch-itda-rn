import { useState } from 'react';
import type { AppUser, Gender } from '@/domain/types';
import { api } from '@/services/api';
import { useAction } from '@/hooks/use-resource';
import { Body, Button, Card, Chip, Field, Notice, Row } from './ui';

export function ProfileEditor({ user, onSaved }: { user: AppUser; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(user.name);
  const [peerGroup, setPeerGroup] = useState(user.peerGroup || '');
  const [gender, setGender] = useState<Gender | ''>(user.gender || '');
  const [phoneNumber, setPhoneNumber] = useState(user.phoneNumber || '');
  const action = useAction();
  const changed = name !== user.name || peerGroup !== (user.peerGroup || '')
    || gender !== (user.gender || '') || phoneNumber !== (user.phoneNumber || '');
  const save = () => void action.run(async () => {
    if (!name.trim()) throw new Error('이름을 입력해 주세요.');
    const phone = phoneNumber.replace(/[\s().-]/g, '');
    if (phone && !/^\+?\d{8,15}$/.test(phone)) throw new Error('연락처를 확인해 주세요.');
    const result = await api.updateProfile({ name: name.trim(), peerGroup: peerGroup.trim() || null, gender: gender || null, phoneNumber: phone || null });
    setName(result.name); setPeerGroup(result.peerGroup || ''); setGender(result.gender || ''); setPhoneNumber(result.phoneNumber || '');
    await onSaved(); action.setNotice('내 정보를 저장했습니다. 이미 접수한 신청서는 자동으로 바뀌지 않습니다.');
  });
  return <Card>
    <Field label="이름" value={name} onChangeText={setName} maxLength={50} editable={!action.busy} autoComplete="name" />
    <Field label="또래" value={peerGroup} onChangeText={setPeerGroup} maxLength={30} editable={!action.busy} placeholder="예: 97또래" />
    <Body>성별</Body><Row>{([{ value: 'male', label: '남성' }, { value: 'female', label: '여성' }, { value: 'other', label: '기타' }, { value: '', label: '미입력' }] as const).map(item => <Chip key={item.value} label={item.label} selected={gender === item.value} onPress={() => { if (!action.busy) setGender(item.value); }} />)}</Row>
    <Field label="연락처" value={phoneNumber} onChangeText={setPhoneNumber} editable={!action.busy} keyboardType="phone-pad" autoComplete="tel" maxLength={40} placeholder="010-1234-5678" />
    <Body muted>저장된 정보는 수련회 신청서에 미리 입력되며 신청서에서 수정할 수 없습니다. 변경은 이곳에서 해 주세요.</Body>
    {action.notice && <Notice>{action.notice}</Notice>}{action.error && <Notice danger>{action.error}</Notice>}
    <Button label="내 정보 저장" variant="secondary" busy={action.busy} disabled={!changed || !name.trim()} onPress={save} />
  </Card>;
}
