import { AppText as Text } from '@/components/app-text';
import { useCallback, useState } from 'react';
import { Pressable } from 'react-native';
import { api } from '@/services/api';
import { useResource } from '@/hooks/use-resource';
import { Badge, Body, Button, Card, EmptyState, ErrorState, Field, LoadingState, Row, common } from '@/components/ui';

export type EventSourceOption = Awaited<ReturnType<typeof api.listEventSources>>[number];

export function EventSourcePicker({ selectedId, selectedLabel, onSelect, onClear }: {
  selectedId?: string | null; selectedLabel?: string; onSelect: (source: EventSourceOption) => void; onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const resource = useResource(useCallback(() => open ? api.listEventSources() : Promise.resolve([]), [open]));
  const items = (resource.data || []).filter(item => `${item.title} ${item.body}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <Card>
    {selectedId ? <><Badge label="주보 원문 연결됨" /><Body>{selectedLabel || '연결된 주보 안내가 있습니다.'}</Body></> : <Body muted>기존 주보의 안내를 선택해 연결할 수 있어요.</Body>}
    <Button label={open ? '주보 목록 닫기' : selectedId ? '연결할 주보 다시 선택' : '주보에서 안내 선택'} variant="secondary" onPress={() => setOpen(value => !value)} />
    {open && <><Field label="주보 안내 검색" value={query} onChangeText={setQuery} placeholder="안내 제목 또는 내용" />
      {resource.loading ? <LoadingState label="기존 주보 안내를 불러오고 있어요" /> : resource.error ? <ErrorState message={resource.error} onRetry={() => void resource.reload()} /> : items.length ? items.map(source => <Pressable key={source.id} accessibilityRole="button" accessibilityState={{ selected: source.id === selectedId }} onPress={() => { onSelect(source); setOpen(false); }}><Card><Row between><Text style={[common.title, common.grow]}>{source.title}</Text>{source.id === selectedId && <Badge label="선택됨" />}</Row>{!!source.body && <Text numberOfLines={2} style={common.caption}>{source.body}</Text>}<Body muted>이 안내 선택하기 →</Body></Card></Pressable>) : <EmptyState title="선택할 주보 안내가 없어요" description="검색어를 바꾸거나 주보에 안내를 먼저 등록해 주세요." />}
    </>}
    {selectedId && <Button label="주보 연결 해제" variant="ghost" compact onPress={onClear} />}
  </Card>;
}
