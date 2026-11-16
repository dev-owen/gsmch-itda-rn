import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, Check, ChevronLeft, ChevronRight, Mail, RefreshCw, Save, Search, ShieldCheck, UserRound, Users } from 'lucide-react';
import { api, json, showToast } from './lib';
import { AdminBadge, AdminDialog, AdminNotice, ATTENDANCE_LABELS, GENDER_LABELS, formatAdminDate } from './itda-admin-shared';
import './users-admin.css';

type Gender = 'male' | 'female' | 'other';
type User = {
  id: string; name: string; role: 'admin' | 'user'; isMemberVerified: boolean;
  verificationRequestedAt: string | null; version: number; peerGroup: string | null;
  gender: Gender | null; phoneNumber: string | null; email: string | null;
  providers: string[]; createdAt: string | null; updatedAt: string | null;
};
type Page<T> = { items: T[]; nextCursor: string | null };
type Verification = '' | 'verified' | 'pending' | 'unverified';
type HistoryItem = {
  id: string; eventId: string; participantName: string; status: 'confirmed' | 'cancelled';
  effectiveStatus: string; attendanceStatus: 'unmarked' | 'present' | 'absent'; confirmedAt: string | null;
  event?: { title: string; startsAt: string | null; lifecycleStatus: string; isDemo?: boolean };
};
type ProfileForm = { name: string; peerGroup: string; gender: Gender | ''; phoneNumber: string };
const VERIFICATIONS: { value: Verification; label: string }[] = [
  { value: '', label: '전체 회원' }, { value: 'pending', label: '인증 요청' },
  { value: 'verified', label: '인증 완료' }, { value: 'unverified', label: '미인증' },
];
const PROVIDERS: Record<string, string> = { google: 'Google', kakao: '카카오', apple: 'Apple' };
const message = (error: unknown) => error instanceof Error ? error.message : '요청을 처리하지 못했습니다.';
const profileForm = (user: User): ProfileForm => ({ name: user.name, peerGroup: user.peerGroup || '', gender: user.gender || '', phoneNumber: user.phoneNumber || '' });
function VerificationBadge({ user }: { user: User }) {
  return user.isMemberVerified ? <AdminBadge tone="green">인증 완료</AdminBadge>
    : user.verificationRequestedAt ? <AdminBadge tone="amber">인증 요청</AdminBadge> : <AdminBadge tone="neutral">미인증</AdminBadge>;
}
function Providers({ providers }: { providers: string[] }) {
  return <span className="user-providers">{providers.length ? providers.map(provider => <span className={`user-provider user-provider-${provider === 'kakao' ? 'kakao' : 'default'}`} key={provider}>{PROVIDERS[provider] || provider}</span>) : <span className="itda-muted">연결 정보 없음</span>}</span>;
}

export function UsersAdminPage() {
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('user');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [verification, setVerification] = useState<Verification>('');
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const cursor = cursors[cursors.length - 1];
  const [data, setData] = useState<Page<User>>({ items: [], nextCursor: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true); setError('');
    const query = new URLSearchParams({ limit: '50' });
    if (search) query.set('search', search);
    if (verification) query.set('verification', verification);
    if (cursor) query.set('cursor', cursor);
    api<Page<User>>(`/v1/admin/users?${query}`, { signal: controller.signal }).then(result => {
      if (active) setData(result);
    }).catch(reason => { if (active) setError(message(reason)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [search, verification, cursor, revision]);
  function submitSearch(event: FormEvent) {
    event.preventDefault(); setCursors([null]); setSearch(searchInput.trim());
  }
  function selectVerification(value: Verification) { setVerification(value); setCursors([null]); }
  function openUser(id: string) { const next = new URLSearchParams(params); next.set('user', id); setParams(next); }
  function closeUser() { const next = new URLSearchParams(params); next.delete('user'); setParams(next); }
  return <div className="admin-page itda-page users-admin-page">
    <div className="admin-page-heading"><div><span className="eyebrow dark">PEOPLE & ACCOUNTS</span><h1>회원 관리</h1><p>로그인한 사용자의 기본 정보와 성도 인증 상태를 관리하세요.</p></div><button className="secondary-button" onClick={() => setRevision(value => value + 1)} disabled={loading}><RefreshCw size={16} className={loading ? 'user-spin' : ''} /> 새로고침</button></div>
    <div className="users-context"><span className="users-context-icon"><Users size={22} /></span><div><strong>사람을 잇는, 잇다</strong><p>회원 정보와 수련회 신청 정보를 한곳에서 확인할 수 있습니다.</p></div><AdminBadge tone="blue">관리자 전용</AdminBadge></div>
    <section className="itda-card users-directory" aria-label="회원 목록">
      <div className="users-directory-head"><div><h2>회원 목록</h2><p>이름, 이메일 또는 연락처로 찾아보세요.</p></div><form className="itda-search users-search" onSubmit={submitSearch}><Search size={17} /><input aria-label="회원 검색" maxLength={100} placeholder="이름, 이메일, 연락처 검색" value={searchInput} onChange={event => setSearchInput(event.target.value)} /><button type="submit">검색</button></form></div>
      <div className="users-filter-row"><div className="users-filter-tabs" aria-label="성도 인증 상태">{VERIFICATIONS.map(item => <button key={item.value} className={verification === item.value ? 'active' : ''} aria-pressed={verification === item.value} onClick={() => selectVerification(item.value)}>{item.value === 'verified' && <ShieldCheck size={15} />}{item.label}</button>)}</div><span className="itda-muted">페이지당 최대 50명</span></div>
      <AdminNotice error={error} />
      <div className="itda-table-wrap" aria-busy={loading}><table className="itda-table users-table"><thead><tr><th scope="col">회원</th><th scope="col">또래 / 연락처</th><th scope="col">로그인 수단</th><th scope="col">성도 인증</th><th scope="col">앱 등록일</th><th scope="col"><span className="users-sr-only">상세 보기</span></th></tr></thead><tbody>
        {loading ? <tr><td colSpan={6}><div className="itda-empty"><RefreshCw size={24} className="user-spin" /><p>회원 정보를 불러오고 있습니다.</p></div></td></tr> : error ? <tr><td colSpan={6}><div className="itda-empty"><p>회원 목록을 불러오지 못했습니다.</p><button className="secondary-button" onClick={() => setRevision(value => value + 1)}>다시 시도</button></div></td></tr> : data.items.length === 0 ? <tr><td colSpan={6}><div className="itda-empty"><UserRound size={30} /><h3>{search || verification ? '조건에 맞는 회원이 없습니다' : '아직 등록된 회원이 없습니다'}</h3><p>{search || verification ? '검색어 또는 인증 상태를 바꿔보세요.' : '앱을 이용한 회원이 여기에 표시됩니다.'}</p></div></td></tr> : data.items.map(user => <tr key={user.id}><td><button className="users-person" onClick={() => openUser(user.id)}><span className="users-avatar" aria-hidden="true">{Array.from(user.name || '?')[0]}</span><span><strong>{user.name || '이름 미입력'}{user.role === 'admin' && <span className="users-admin-label">관리자</span>}</strong><small>{user.email || '이메일 없음'}</small></span></button></td><td><span className="users-cell-primary">{user.peerGroup || '또래 미입력'}</span><small className="users-cell-secondary">{user.phoneNumber || '연락처 미입력'}</small></td><td><Providers providers={user.providers} /></td><td><VerificationBadge user={user} /></td><td className="users-date">{formatAdminDate(user.createdAt)}</td><td><button className="itda-row-action" onClick={() => openUser(user.id)} aria-label={`${user.name || '회원'} 상세 보기`}>상세 <ChevronRight size={15} /></button></td></tr>)}
      </tbody></table></div>
      <div className="itda-pagination"><span className="itda-muted">{loading ? '불러오는 중…' : error ? '연결을 확인해 주세요' : `${cursors.length}페이지 · ${data.items.length}명 표시`}</span><div className="users-page-controls"><button className="secondary-button" disabled={loading || cursors.length <= 1} onClick={() => setCursors(value => value.slice(0, -1))}><ChevronLeft size={16} /> 이전</button><button className="secondary-button" disabled={loading || !!error || !data.nextCursor} onClick={() => setCursors(value => [...value, data.nextCursor])}>다음 <ChevronRight size={16} /></button></div></div>
    </section>
    <p className="users-footnote"><ShieldCheck size={14} /> 기본 정보 수정은 계정에만 적용됩니다. 이미 접수한 신청서의 정보는 그대로 보존됩니다.</p>
    {selectedId && <UserDetail key={selectedId} id={selectedId} onClose={closeUser} onChanged={() => setRevision(value => value + 1)} />}
  </div>;
}

function UserDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [user, setUser] = useState<User | null>(null);
  const [form, setForm] = useState<ProfileForm | null>(null);
  const [tab, setTab] = useState<'profile' | 'history'>('profile');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [revision, setRevision] = useState(0);
  const [revoke, setRevoke] = useState(false);
  const [discard, setDiscard] = useState(false);
  const alive = useRef(true);
  const dirty = !!user && !!form && JSON.stringify(form) !== JSON.stringify(profileForm(user));
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController(); let active = true;
    setLoading(true); setError(''); setConflict(false); setRevoke(false);
    api<{ user: User }>(`/v1/admin/users/${encodeURIComponent(id)}`, { signal: controller.signal }).then(result => {
      if (active) { setUser(result.user); setForm(profileForm(result.user)); }
    }).catch(reason => { if (active) setError(message(reason)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [id, revision]);
  function fail(reason: unknown) { setError(message(reason)); setConflict((reason as { status?: number })?.status === 409); }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!form || !user || busy || !dirty) return;
    const snapshot = { name: form.name.trim(), peerGroup: form.peerGroup.trim() || null, gender: form.gender || null, phoneNumber: form.phoneNumber.trim() || null, expectedVersion: user.version };
    setBusy(true); setError(''); setConflict(false);
    try {
      const result = await api<{ user: User }>(`/v1/admin/users/${encodeURIComponent(id)}/profile`, json(snapshot, 'PATCH'));
      if (!alive.current) return;
      setUser(result.user); setForm(profileForm(result.user)); onChanged(); showToast('회원 정보를 저장했습니다.');
    } catch (reason) { if (alive.current) fail(reason); } finally { if (alive.current) setBusy(false); }
  }
  async function verify(verified: boolean) {
    if (!user || busy || dirty) return;
    setBusy(true); setError(''); setConflict(false);
    try {
      const result = await api<{ user: Partial<User> }>(`/v1/admin/users/${encodeURIComponent(id)}/member-verification`, json({ isMemberVerified: verified, expectedVersion: user.version }, 'POST'));
      if (!alive.current) return;
      const updated = { ...user, ...result.user };
      setUser(updated); setForm(profileForm(updated)); setRevoke(false); onChanged(); showToast(verified ? '성도 인증을 완료했습니다.' : '성도 인증을 해제했습니다.');
      const fresh = await api<{ user: User }>(`/v1/admin/users/${encodeURIComponent(id)}`);
      if (alive.current) { setUser(fresh.user); setForm(profileForm(fresh.user)); }
    } catch (reason) { if (alive.current) fail(reason); } finally { if (alive.current) setBusy(false); }
  }
  function update(change: Partial<ProfileForm>) { setForm(value => value ? { ...value, ...change } : value); setRevoke(false); }
  function requestClose() { if (busy) return; if (dirty) setDiscard(true); else onClose(); }
  return <AdminDialog title="회원 상세" onClose={requestClose}>
    {loading ? <div className="itda-empty"><RefreshCw className="user-spin" size={24} /><p>회원 정보를 불러오고 있습니다.</p></div> : !user || !form ? <><AdminNotice error={error} /><button className="secondary-button" onClick={() => setRevision(value => value + 1)}>다시 시도</button></> : <div className="user-detail">
      <div className="user-detail-identity"><span className="users-avatar large" aria-hidden="true">{Array.from(user.name || '?')[0]}</span><div><h3>{user.name || '이름 미입력'}</h3><p><Mail size={14} />{user.email || '이메일 없음'}</p><div className="user-detail-badges"><VerificationBadge user={user} /><AdminBadge tone={user.role === 'admin' ? 'blue' : 'neutral'}>{user.role === 'admin' ? '관리자' : '일반 회원'}</AdminBadge></div></div></div>
      <div className="user-detail-tabs" role="group" aria-label="회원 상세 메뉴"><button type="button" aria-pressed={tab === 'profile'} onClick={() => setTab('profile')}>기본 정보</button><button type="button" aria-pressed={tab === 'history'} onClick={() => setTab('history')}>신청 내역</button></div>
      <AdminNotice error={error} />
      {discard && <div className="user-conflict"><p>저장하지 않은 변경 사항이 있습니다. 변경 내용을 버리고 닫으시겠습니까?</p><div className="user-discard-actions"><button className="secondary-button" onClick={() => setDiscard(false)}>계속 수정</button><button className="user-danger-button" onClick={onClose}>변경 내용 버리고 닫기</button></div></div>}
      {conflict && <div className="user-conflict"><p>다른 변경이 반영되었습니다. 최신 정보를 불러온 뒤 다시 수정해 주세요.</p><button className="secondary-button" disabled={busy} onClick={() => setRevision(value => value + 1)}>최신 정보 불러오기 · 입력 초기화</button></div>}
      {tab === 'profile' ? <>
        <form className="user-profile-form" onSubmit={save}>
          <fieldset disabled={busy || conflict}><legend className="users-sr-only">회원 기본 정보 수정</legend><div className="user-profile-fields"><label className="itda-label">이름 *<input required maxLength={50} value={form.name} onChange={event => update({ name: event.target.value })} /></label><label className="itda-label">또래<input maxLength={30} placeholder="예: 96또래" value={form.peerGroup} onChange={event => update({ peerGroup: event.target.value })} /></label><label className="itda-label">성별<select value={form.gender} onChange={event => update({ gender: event.target.value as Gender | '' })}><option value="">미입력</option>{Object.entries(GENDER_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label className="itda-label">연락처<input type="tel" maxLength={40} placeholder="010-0000-0000" value={form.phoneNumber} onChange={event => update({ phoneNumber: event.target.value })} /></label></div></fieldset>
          <div className="user-profile-save"><span>{busy ? '변경 내용을 처리하고 있습니다…' : dirty ? '저장하지 않은 변경 사항이 있습니다.' : '기본 정보를 수정한 뒤 저장하세요.'}</span><button className="primary-button" type="submit" disabled={busy || !dirty || conflict}><Save size={16} />{busy ? '처리 중…' : '정보 저장'}</button></div>
        </form>
        <section className="user-verification-card" aria-label="성도 인증 관리"><div><ShieldCheck size={19} /><h4>성도 인증</h4><VerificationBadge user={user} /></div><p>{user.isMemberVerified ? '인증된 회원은 성도 전용 행사에 신청할 수 있습니다.' : user.verificationRequestedAt ? `${formatAdminDate(user.verificationRequestedAt, true)}에 인증을 요청했습니다.` : '교회 소속을 확인한 뒤 성도 인증을 처리해 주세요.'}</p>{dirty && <p className="user-verification-hint">기본 정보 변경을 먼저 저장하면 인증 상태를 변경할 수 있습니다.</p>}{revoke ? <div className="user-revoke-confirm"><p>성도 인증을 해제하면 성도 전용 행사 이용이 제한됩니다. 해제하시겠습니까?</p><div><button className="secondary-button" disabled={busy} onClick={() => setRevoke(false)}>돌아가기</button><button className="user-danger-button" disabled={busy || dirty || conflict} onClick={() => verify(false)}>인증 해제하기</button></div></div> : <button className={user.isMemberVerified ? 'secondary-button' : 'primary-button'} disabled={busy || dirty || conflict} onClick={() => user.isMemberVerified ? setRevoke(true) : verify(true)}>{user.isMemberVerified ? '인증 해제' : <><Check size={16} /> 성도 인증 승인</>}</button>}</section>
        <section className="user-account-info" aria-label="로그인 계정 정보"><h4>로그인 계정</h4><dl><div><dt>연결된 로그인</dt><dd><Providers providers={user.providers} /></dd></div><div><dt>앱 등록일</dt><dd>{formatAdminDate(user.createdAt, true)}</dd></div><div><dt>마지막 정보 변경</dt><dd>{formatAdminDate(user.updatedAt, true)}</dd></div></dl><p>이메일과 로그인 수단은 연결된 계정에서 관리합니다.</p></section>
      </> : <UserHistory id={id} navigationBlocked={dirty || busy} blockedReason={busy ? '정보를 처리하는 동안 접수 관리로 이동할 수 없습니다.' : '기본 정보 변경을 먼저 저장하면 접수 관리로 이동할 수 있습니다.'} />}
    </div>}
  </AdminDialog>;
}

function UserHistory({ id, navigationBlocked, blockedReason }: { id: string; navigationBlocked: boolean; blockedReason: string }) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); let active = true;
    setLoading(true); setError('');
    const query = new URLSearchParams({ limit: '50' }); if (cursor) query.set('cursor', cursor);
    api<Page<HistoryItem>>(`/v1/admin/users/${encodeURIComponent(id)}/registrations?${query}`, { signal: controller.signal }).then(result => {
      if (active) { setItems(previous => cursor ? [...previous.filter(item => !result.items.some(next => next.id === item.id)), ...result.items] : result.items); setNextCursor(result.nextCursor); }
    }).catch(reason => { if (active) setError(message(reason)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [id, cursor, revision]);
  return <section className="user-history" aria-label="회원 신청 내역" aria-busy={loading}>
    <p className="user-history-description">회원의 행사 신청 및 출석 상태를 확인하세요.</p>{navigationBlocked && <p className="user-history-blocked" role="status">{blockedReason}</p>}<AdminNotice error={error} />
    {items.map(item => <article className="user-history-item" key={item.id}><div><h4>{item.event?.title || '행사'}</h4><div className="user-history-badges"><AdminBadge tone={item.effectiveStatus === 'event_cancelled' || item.status === 'cancelled' ? 'neutral' : 'green'}>{item.effectiveStatus === 'event_cancelled' ? '행사 취소' : item.status === 'cancelled' ? '신청 취소' : '접수 완료'}</AdminBadge>{item.status === 'confirmed' && <AdminBadge tone={item.attendanceStatus === 'present' ? 'blue' : item.attendanceStatus === 'absent' ? 'amber' : 'neutral'}>{ATTENDANCE_LABELS[item.attendanceStatus]}</AdminBadge>}{item.event?.isDemo && <AdminBadge tone="amber">체험 행사</AdminBadge>}</div><p>접수 {formatAdminDate(item.confirmedAt, true)}</p></div>{navigationBlocked ? <button type="button" disabled className="itda-row-action" aria-label={`${item.event?.title || '행사'} 접수 관리`} title={blockedReason}>관리 <ArrowRight size={15} /></button> : <Link to={`/admin/retreats?event=${encodeURIComponent(item.eventId)}`} className="itda-row-action" aria-label={`${item.event?.title || '행사'} 접수 관리`}>관리 <ArrowRight size={15} /></Link>}</article>)}
    {loading && <div className="itda-empty user-history-loading"><RefreshCw className="user-spin" size={22} /><p>신청 내역을 불러오고 있습니다.</p></div>}
    {!loading && !error && !items.length && <div className="itda-empty"><Users size={26} /><h3>아직 신청 내역이 없습니다</h3><p>행사에 신청하면 이곳에 내역이 표시됩니다.</p></div>}
    {!loading && error && <button className="secondary-button" onClick={() => setRevision(value => value + 1)}>다시 시도</button>}
    {!loading && !error && nextCursor && <button className="secondary-button full" onClick={() => setCursor(nextCursor)}>신청 내역 더 보기 <ChevronRight size={16} /></button>}
  </section>;
}
