import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowUpRight, Bus, CalendarDays, Check, ChevronLeft, ChevronRight, ClipboardList, Download, MapPin, RefreshCw, Search, Users } from 'lucide-react';
import { api, json, showToast } from './lib';
import { AdminBadge, AdminDialog, AdminNotice, ATTENDANCE_LABELS, DEPARTURE_LABELS, GENDER_LABELS, formatAdminDate } from './itda-admin-shared';
import './retreat-admin.css';

type Attendance = 'unmarked' | 'present' | 'absent';
type Departure = 'main' | 'late' | 'car' | 'other';
type AdminEvent = {
  id: string; title: string; location: string; startsAt: string | null; endsAt: string | null;
  registrationStatus: string; lifecycleStatus: 'active' | 'cancelled' | 'completed';
  isDemo: boolean; retreatSlug?: string; publicationStatus: string;
};
type Registration = {
  id: string; eventId: string; userId: string; participantName: string; confirmationCode: string;
  status: 'confirmed' | 'cancelled'; attendanceStatus: Attendance; version: number;
  confirmedAt: string; cancelledAt: string | null; checkedAt: string | null; checkedBy?: string | null;
  answers?: { peerGroup: string; gender: 'male' | 'female' | 'other'; phoneNumber: string;
    departureOption: Departure; departureNote: string | null; prayerRequest: string | null };
};
type Page<T> = { items: T[]; nextCursor: string | null };
const PAGE_SIZE = 15;
const EVENT_STATUS: Record<string, string> = { open: '접수 중', upcoming: '접수 예정', closed: '접수 마감', disabled: '접수 비활성', cancelled: '행사 취소', completed: '행사 종료', unavailable: '비공개' };
const isRetreat = (event: AdminEvent) => !!event.retreatSlug || /수련회|동계|겨울/.test(event.title);

async function allPages<T>(path: string, signal: AbortSignal): Promise<T[]> {
  const items: T[] = [], cursors = new Set<string>();
  let cursor: string | null = null;
  do {
    const result: Page<T> = await api<Page<T>>(`${path}?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { signal });
    items.push(...result.items);
    cursor = result.nextCursor;
    if (cursor && cursors.has(cursor)) throw new Error('목록을 모두 불러오지 못했습니다. 새로고침해 주세요.');
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return items;
}

function csvCell(value: unknown) {
  let text = String(value ?? '');
  if (/^[\s\uFEFF]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function RetreatAdminPage() {
  const [params, setParams] = useSearchParams();
  const requestedEventId = params.get('event');
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const requestedEvent = events.find((item) => item.id === requestedEventId);
  const eventId = requestedEvent?.id || events[0]?.id || '';
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsError, setEventsError] = useState('');
  const [eventsRevision, setEventsRevision] = useState(0);
  const [rows, setRows] = useState<Registration[]>([]);
  const [rosterEventId, setRosterEventId] = useState('');
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState('');
  const [revision, setRevision] = useState(0);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [attendance, setAttendance] = useState('all');
  const [departure, setDeparture] = useState('all');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmCancellation, setConfirmCancellation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mutationError, setMutationError] = useState('');
  const currentEventId = useRef(eventId);
  currentEventId.current = eventId;
  const event = events.find((item) => item.id === eventId);
  const eventCancelled = event?.lifecycleStatus === 'cancelled';
  const selected = rosterEventId === eventId ? rows.find((row) => row.id === selectedId) : undefined;
  const registrationLabel = (row: Registration) => row.status === 'cancelled' ? '신청 취소' : eventCancelled ? '행사 취소' : '접수 완료';
  const attendanceLabel = (row: Registration) => row.status !== 'confirmed' || (eventCancelled && row.attendanceStatus === 'unmarked') ? ''
    : `${ATTENDANCE_LABELS[row.attendanceStatus]}${eventCancelled ? ' (행사 취소 전 기록)' : ''}`;

  useEffect(() => {
    const controller = new AbortController();
    setEventsLoading(true); setEventsError('');
    allPages<AdminEvent>('/v1/admin/events', controller.signal).then((items) => {
      if (controller.signal.aborted) return;
      const sorted = [...items].sort((a, b) => Number(!!b.retreatSlug) - Number(!!a.retreatSlug)
        || Number(isRetreat(b)) - Number(isRetreat(a))
        || Number(b.lifecycleStatus === 'active') - Number(a.lifecycleStatus === 'active'));
      setEvents(sorted);
    }).catch((error) => { if (!controller.signal.aborted) setEventsError(error.message || '행사를 불러오지 못했습니다.'); })
      .finally(() => { if (!controller.signal.aborted) setEventsLoading(false); });
    return () => controller.abort();
  }, [eventsRevision]);

  useEffect(() => {
    const controller = new AbortController();
    setRows([]); setSelectedId(null); setConfirmCancellation(false); setRosterError(''); setMutationError('');
    if (!eventId) { setRosterLoading(false); return () => controller.abort(); }
    setRosterLoading(true);
    allPages<Registration>(`/v1/admin/events/${encodeURIComponent(eventId)}/registrations`, controller.signal).then((items) => {
      if (!controller.signal.aborted) { setRows(items); setRosterEventId(eventId); }
    }).catch((error) => { if (!controller.signal.aborted) setRosterError(error.message || '접수 내역을 불러오지 못했습니다.'); })
      .finally(() => { if (!controller.signal.aborted) setRosterLoading(false); });
    return () => controller.abort();
  }, [eventId, revision]);

  useEffect(() => { setPage(1); }, [search, status, attendance, departure, eventId]);
  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    const phoneTerm = term.replace(/[\s().-]/g, '');
    return rows.filter((row) => {
      const matchesText = !term || [row.participantName, row.confirmationCode, row.answers?.peerGroup].some((value) => value?.toLocaleLowerCase().includes(term))
        || (!!phoneTerm && !!row.answers?.phoneNumber.includes(phoneTerm));
      return matchesText && (status === 'all' || row.status === status)
        && (attendance === 'all' || (row.status === 'confirmed' && row.attendanceStatus === attendance))
        && (departure === 'all' || row.answers?.departureOption === departure);
    });
  }, [rows, search, status, attendance, departure]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visibleRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const confirmed = eventCancelled ? [] : rows.filter((row) => row.status === 'confirmed');
  const pending = eventsLoading || rosterLoading || (!!eventId && rosterEventId !== eventId && !rosterError);
  const ready = !!eventId && rosterEventId === eventId && !pending && !rosterError && !eventsError;
  const statistics = [
    { label: '유효 접수', value: confirmed.length, unit: '명', icon: Users, description: '현재 신청이 확정된 인원' },
    { label: '출석 확인', value: confirmed.filter((row) => row.attendanceStatus === 'present').length, unit: '명', icon: Check, description: '유효 접수 중 출석한 인원' },
    { label: '본대 / 후발대', value: `${confirmed.filter((row) => row.answers?.departureOption === 'main').length} / ${confirmed.filter((row) => row.answers?.departureOption === 'late').length}`, unit: '명', icon: Bus, description: '유효 접수의 이동 방식' },
    { label: '취소된 신청', value: rows.filter((row) => row.status === 'cancelled').length, unit: '건', icon: ClipboardList, description: '신청 취소 내역' },
  ];

  function openDetail(row: Registration) { setSelectedId(row.id); setConfirmCancellation(false); setMutationError(''); }
  function refreshRoster() { if (!busy) setRevision((value) => value + 1); }
  async function mutate(row: Registration, nextAttendance?: Attendance) {
    if (busy || !eventId) return;
    const mutationEventId = eventId;
    setBusy(true); setMutationError('');
    try {
      const suffix = nextAttendance ? '/attendance' : '';
      const response = await api<{ registration: Registration }>(`/v1/admin/events/${encodeURIComponent(eventId)}/registrations/${encodeURIComponent(row.id)}${suffix}`,
        json({ expectedVersion: row.version, ...(nextAttendance ? { attendanceStatus: nextAttendance } : {}) }, nextAttendance ? 'PATCH' : 'DELETE'));
      if (currentEventId.current !== mutationEventId) return;
      setRows((items) => items.map((item) => item.id === row.id ? { ...item, ...response.registration, userId: item.userId } : item));
      setConfirmCancellation(false);
      showToast(nextAttendance ? '출석 상태를 저장했습니다.' : '신청을 취소했습니다.');
    } catch (error) {
      if (currentEventId.current !== mutationEventId) return;
      const message = error instanceof Error ? error.message : '변경 내용을 저장하지 못했습니다.';
      if ((error as { status?: number }).status === 409) {
        setRevision((value) => value + 1);
        showToast(`${message} 최신 목록을 다시 불러옵니다.`, 'error');
      } else setMutationError(message);
    } finally { setBusy(false); }
  }

  function downloadCsv() {
    if (!ready || !event) return;
    const columns = ['이름', '또래', '성별', '연락처', '접수 상태', '출석 상태', '출발 방식', '출발 메모', '접수 코드', '신청일', '취소일'];
    const data = filtered.map((row) => [row.participantName, row.answers?.peerGroup, row.answers ? GENDER_LABELS[row.answers.gender] : '',
      row.answers?.phoneNumber ? `'${row.answers.phoneNumber}` : '', registrationLabel(row),
      attendanceLabel(row), row.answers ? DEPARTURE_LABELS[row.answers.departureOption] : '',
      row.answers?.departureNote, row.confirmationCode, formatAdminDate(row.confirmedAt, true), row.cancelledAt ? formatAdminDate(row.cancelledAt, true) : '']);
    const blob = new Blob(['\uFEFF', [columns, ...data].map((line) => line.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = `${event.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')}_접수명단.csv`;
    document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(`${filtered.length.toLocaleString()}건의 접수 내역을 내려받았습니다.`);
  }

  return <div className="admin-page itda-page retreat-admin-page">
    <div className="admin-page-heading"><div><span className="eyebrow dark">RETREAT REGISTRATIONS</span><h1>동계수련회 접수</h1><p>신청 현황부터 이동 방식과 출석까지 한곳에서 관리하세요.</p></div>
      <div className="retreat-heading-actions"><button type="button" className="secondary-button" disabled={busy || eventsLoading || rosterLoading} onClick={() => { setEventsRevision((value) => value + 1); refreshRoster(); }}><RefreshCw size={16} /> 새로고침</button><button type="button" className="primary-button" disabled={!ready || filtered.length === 0} onClick={downloadCsv}><Download size={16} /> CSV 다운로드</button></div>
    </div>

    <AdminNotice error={eventsError || rosterError || (!selected ? mutationError : '')} />
    {requestedEventId && !eventsLoading && !eventsError && !requestedEvent && <div className="form-notice retreat-selection-notice" role="status">요청한 행사를 찾을 수 없습니다.{events.length > 0 ? ' 첫 번째 행사를 표시합니다. 아래에서 관리할 행사를 선택해 주세요.' : ' 등록된 행사를 확인해 주세요.'}</div>}
    {eventsError && <button type="button" className="secondary-button" onClick={() => setEventsRevision((value) => value + 1)}>행사 다시 불러오기</button>}
    <section className="itda-card retreat-event-card" aria-label="관리할 행사">
      <div className="retreat-event-symbol"><CalendarDays size={25} /></div>
      <div className="retreat-event-info"><label className="itda-label" htmlFor="retreat-event">관리할 행사</label>
        <select id="retreat-event" value={eventId} disabled={eventsLoading || busy || events.length === 0} onChange={(e) => { const next = new URLSearchParams(params); next.set('event', e.target.value); setParams(next); }}>
          {events.length === 0 && <option value="">{eventsLoading ? '행사를 불러오는 중…' : '등록된 행사가 없습니다'}</option>}
          {events.map((item) => <option key={item.id} value={item.id}>{!isRetreat(item) ? '[일반 행사] ' : ''}{item.title}{item.isDemo ? ' · 체험용' : ''}</option>)}
        </select>
        {event && <div className="retreat-event-meta"><span><CalendarDays size={14} />{formatAdminDate(event.startsAt)}{event.endsAt && ` – ${formatAdminDate(event.endsAt)}`}</span>{event.location && <span><MapPin size={14} />{event.location}</span>}</div>}
      </div>
      {event && <div className="retreat-event-badges"><AdminBadge tone={event.registrationStatus === 'open' ? 'green' : 'neutral'}>{EVENT_STATUS[event.registrationStatus] || event.registrationStatus}</AdminBadge>{event.isDemo && <AdminBadge tone="amber">체험용 행사</AdminBadge>}</div>}
    </section>
    {event?.isDemo && <p className="retreat-demo-note">이 행사는 화면과 신청 흐름을 확인하기 위한 가상 수련회입니다.</p>}
    {eventCancelled && <div className="form-notice retreat-selection-notice" role="status">취소된 행사입니다. 신청 이력과 취소 전 출석 기록을 확인할 수 있으며, 유효 접수 인원에는 포함하지 않습니다.</div>}

    <div className="itda-stats retreat-statistics" aria-label="접수 현황" aria-busy={eventsLoading || rosterLoading}>
      {statistics.map(({ label, value, unit, icon: Icon, description }) => <div className="itda-card itda-stat" key={label}><div className="retreat-stat-label"><span>{label}</span><Icon size={18} /></div><strong>{ready ? value : '—'}<small>{unit}</small></strong><p>{ready ? description : rosterLoading || eventsLoading ? '전체 접수 내역을 불러오는 중' : '행사와 접수 내역을 확인해 주세요'}</p></div>)}
    </div>

    <section className="itda-card retreat-roster" aria-label="접수 목록">
      <div className="retreat-roster-heading"><div><h2>접수 명단 {ready && <span>{filtered.length.toLocaleString()}<small>건</small></span>}</h2><p>검색과 필터를 적용한 전체 명단을 CSV로 내려받을 수 있습니다. 기도제목은 파일에 포함하지 않습니다.</p></div></div>
      <div className="itda-toolbar retreat-filters">
        <label className="itda-search"><Search size={17} /><input aria-label="접수 명단 검색" maxLength={100} placeholder="이름, 연락처, 또래, 접수 코드 검색" value={search} onChange={(e) => setSearch(e.target.value)} disabled={!ready} /></label>
        <select aria-label="접수 상태 필터" value={status} onChange={(e) => setStatus(e.target.value)} disabled={!ready}><option value="all">접수 상태 전체</option><option value="confirmed">{eventCancelled ? '행사 취소 · 신청 이력' : '접수 완료'}</option><option value="cancelled">신청 취소</option></select>
        <select aria-label="출석 상태 필터" value={attendance} onChange={(e) => setAttendance(e.target.value)} disabled={!ready}><option value="all">출석 전체</option>{Object.entries(ATTENDANCE_LABELS).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select>
        <select aria-label="출발 방식 필터" value={departure} onChange={(e) => setDeparture(e.target.value)} disabled={!ready}><option value="all">출발 방식 전체</option>{Object.entries(DEPARTURE_LABELS).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select>
      </div>
      {pending ? <div className="itda-empty" role="status"><RefreshCw size={25} className="retreat-loading-icon" /><h3>전체 접수 내역을 불러오고 있습니다</h3><p>모든 내역을 확인한 뒤 현황과 명단을 표시합니다.</p></div>
        : rosterError || eventsError ? <div className="itda-empty"><ClipboardList size={28} /><h3>접수 명단을 불러오지 못했습니다</h3><button type="button" className="secondary-button" onClick={() => { setEventsRevision((value) => value + 1); refreshRoster(); }}>다시 시도</button></div>
        : !eventId ? <div className="itda-empty"><CalendarDays size={29} /><h3>등록된 행사가 없습니다</h3><p>행사가 등록되면 이곳에서 신청과 출석을 관리할 수 있습니다.</p></div>
        : filtered.length === 0 ? <div className="itda-empty"><Search size={28} /><h3>{rows.length ? '조건에 맞는 신청이 없습니다' : '아직 접수된 신청이 없습니다'}</h3><p>{rows.length ? '검색어나 필터를 변경해 주세요.' : '접수가 시작되면 신청 내역이 이곳에 표시됩니다.'}</p>{rows.length > 0 && <button type="button" className="secondary-button" onClick={() => { setSearch(''); setStatus('all'); setAttendance('all'); setDeparture('all'); }}>필터 초기화</button>}</div>
        : <><div className="itda-table-wrap"><table className="itda-table retreat-table"><thead><tr><th scope="col">신청자</th><th scope="col">또래 / 성별</th><th scope="col">연락처</th><th scope="col">출발 방식</th><th scope="col">접수 상태</th><th scope="col">{eventCancelled ? '취소 전 출석 기록' : '출석'}</th><th scope="col">신청일</th><th scope="col"><span className="retreat-sr-only">관리</span></th></tr></thead><tbody>{visibleRows.map((row) => <tr key={row.id}>
          <td><button type="button" className="retreat-name-button" onClick={() => openDetail(row)}><span className="retreat-avatar">{row.participantName.slice(0, 1)}</span><span><strong>{row.participantName}</strong><small>{row.confirmationCode}</small></span></button></td>
          <td><span>{row.answers?.peerGroup || '—'}</span><small className="retreat-cell-subtext">{row.answers ? GENDER_LABELS[row.answers.gender] : '정보 없음'}</small></td>
          <td className="retreat-phone">{row.answers?.phoneNumber || '—'}</td><td>{row.answers ? <span className="retreat-departure"><Bus size={14} />{DEPARTURE_LABELS[row.answers.departureOption]}</span> : '—'}</td>
          <td><AdminBadge tone={row.status === 'confirmed' && !eventCancelled ? 'green' : 'neutral'}>{registrationLabel(row)}</AdminBadge></td>
          <td>{!attendanceLabel(row) ? <span className="itda-muted">—</span> : <AdminBadge tone={eventCancelled ? 'neutral' : row.attendanceStatus === 'present' ? 'blue' : row.attendanceStatus === 'absent' ? 'amber' : 'neutral'}>{ATTENDANCE_LABELS[row.attendanceStatus]}</AdminBadge>}</td>
          <td className="retreat-date">{formatAdminDate(row.confirmedAt)}</td><td><button type="button" className="itda-row-action" aria-label={`${row.participantName} 신청 상세 보기`} onClick={() => openDetail(row)}>상세 <ChevronRight size={14} /></button></td>
        </tr>)}</tbody></table></div>
          <div className="itda-pagination"><span>전체 {filtered.length.toLocaleString()}건 중 {((currentPage - 1) * PAGE_SIZE + 1).toLocaleString()}–{Math.min(currentPage * PAGE_SIZE, filtered.length).toLocaleString()}건</span><div><button type="button" className="icon-button" aria-label="이전 페이지" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={18} /></button><span>{currentPage} / {pageCount}</span><button type="button" className="icon-button" aria-label="다음 페이지" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}><ChevronRight size={18} /></button></div></div></>}
    </section>

    {selected && <AdminDialog title="신청 상세" onClose={() => { if (!busy) { setSelectedId(null); setConfirmCancellation(false); } }}>
      <div className="retreat-detail-title"><span className="retreat-avatar large">{selected.participantName.slice(0, 1)}</span><div><h3>{selected.participantName}</h3><p>{event?.title}</p></div><AdminBadge tone={selected.status === 'confirmed' && !eventCancelled ? 'green' : 'neutral'}>{registrationLabel(selected)}</AdminBadge></div>
      <AdminNotice error={mutationError} />
      <dl className="retreat-detail-grid"><div><dt>또래</dt><dd>{selected.answers?.peerGroup || '—'}</dd></div><div><dt>성별</dt><dd>{selected.answers ? GENDER_LABELS[selected.answers.gender] : '—'}</dd></div><div><dt>연락처</dt><dd>{selected.answers?.phoneNumber || '—'}</dd></div><div><dt>접수 코드</dt><dd className="retreat-code">{selected.confirmationCode}</dd></div><div><dt>신청일</dt><dd>{formatAdminDate(selected.confirmedAt, true)}</dd></div><div><dt>취소일</dt><dd>{formatAdminDate(selected.cancelledAt, true)}</dd></div></dl>
      <div className="retreat-detail-section"><h4><Bus size={17} /> 출발 정보</h4><strong>{selected.answers ? DEPARTURE_LABELS[selected.answers.departureOption] : '등록된 출발 정보가 없습니다'}</strong>{selected.answers?.departureNote && <p>{selected.answers.departureNote}</p>}</div>
      <div className="retreat-detail-section retreat-prayer"><h4>기도제목</h4><p>{selected.answers?.prayerRequest || '작성된 기도제목이 없습니다.'}</p></div>
      <div className="retreat-detail-section"><h4>{eventCancelled ? '취소 전 출석 기록' : '출석 관리'}</h4><div className="retreat-attendance-buttons">{(Object.keys(ATTENDANCE_LABELS) as Attendance[]).map((value) => <button type="button" key={value} className={`secondary-button ${selected.attendanceStatus === value ? 'selected' : ''}`} aria-pressed={selected.attendanceStatus === value} disabled={busy || selected.status !== 'confirmed' || eventCancelled || selected.attendanceStatus === value} onClick={() => mutate(selected, value)}>{value === 'present' && <Check size={15} />}{ATTENDANCE_LABELS[value]}</button>)}</div>{selected.checkedAt && <p className="itda-muted">마지막 처리 {formatAdminDate(selected.checkedAt, true)}</p>}{eventCancelled && <p className="itda-muted">행사 취소 전 출석 기록입니다. 취소된 행사는 출석을 변경할 수 없습니다.</p>}</div>
      <div className="retreat-detail-footer"><Link className="secondary-button" aria-disabled={busy} onClick={(e) => { if (busy) e.preventDefault(); }} to={`/admin/users?user=${encodeURIComponent(selected.userId)}`}>회원 정보 보기 <ArrowUpRight size={15} /></Link>{selected.status === 'confirmed' && !confirmCancellation && <button type="button" className="retreat-cancel-button" disabled={busy} onClick={() => setConfirmCancellation(true)}>신청 취소하기</button>}</div>
      {confirmCancellation && selected.status === 'confirmed' && <div className="retreat-cancel-confirm"><strong>{selected.participantName} 님의 신청을 취소할까요?</strong><p>접수가 취소되며 출석 기록도 초기화됩니다. 다시 참가하려면 본인이 재신청해야 합니다.</p><div><button type="button" className="secondary-button" disabled={busy} onClick={() => setConfirmCancellation(false)}>돌아가기</button><button type="button" className="retreat-danger-button" disabled={busy} onClick={() => mutate(selected)}>{busy ? '처리 중…' : '신청 취소 확정'}</button></div></div>}
    </AdminDialog>}
  </div>;
}
