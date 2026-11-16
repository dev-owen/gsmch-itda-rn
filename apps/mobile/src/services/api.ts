import * as Crypto from 'expo-crypto';
import * as Linking from 'expo-linking';
import type { AppUser, EventFilters, EventInput, EventItem, EventSyncStatus, LoginMethod, MergePreview, Provider, Registration, RetreatDetail, RetreatRegistration, RetreatRegistrationInput, SyncResult } from '@/domain/types';
import { writableEvent } from '@/domain/event-input';
import { proofAuthClient, reauthClient, requireNativeAccountFlow, runAccountFlow, signInWith } from './auth';
import { APP_SCHEME } from './config';
import { ApiError } from './errors';
import { secureStorage } from './secure-storage';
import { request } from './transport';
import { assertMobileLoginProvider } from './login-policy';
export { ApiError } from './errors';

type WireEvent = Omit<EventItem, 'registrationStatus' | 'registrationEnabled'> & { registrationEnabled?: boolean; registrationStatus?: string };
type WireRegistration = Omit<Registration, 'event'> & { event?: WireEvent; eventTitle?: string };
type Operation = { id: string; operationToken: string; expiresAt: string; confirmKey: string };
type MergeWire = { id: string; status: string; snapshotHash: string; targetUserId: string; sourceUserId: string;
  users: { userId: string; name: string; role: AppUser['role']; isMemberVerified: boolean }[];
  loginMethods: { provider: string; userId: string }[]; registrationCount: number; duplicateRegistrationCount: number;
  isMemberVerified: boolean; requiresAdminApproval: boolean;
  conflicts: { eventId?: string; code: string; eventTitle?: string; message?: string }[];
  registrationResults?: WireRegistration[] };
const registrationEvents = new Map<string, string>();
const mergePreviews = new Map<string, MergePreview>();
const json = (body: unknown) => JSON.stringify(body);
const pathId = (id: string) => encodeURIComponent(id);
function event(item: WireEvent): EventItem {
  const state = item.registrationStatus;
  return { ...item, registrationEnabled: item.registrationEnabled ?? !['disabled', 'unavailable', 'completed'].includes(state || 'disabled'),
    registrationStatus: state === 'upcoming' ? 'not_open' : ['open', 'closed', 'cancelled'].includes(state || '') ? state as 'open' | 'closed' | 'cancelled' : 'disabled' };
}
function registration(item: WireRegistration): Registration {
  registrationEvents.set(item.id, item.eventId);
  return { ...item, event: item.event ? event(item.event) : undefined };
}
function user(item: AppUser): AppUser { return { ...item, status: item.status || 'active' }; }
async function listAll<T>(path: string): Promise<T[]> {
  const items: T[] = []; const visited = new Set<string>(); let cursor: string | null = null;
  do {
    const query: URLSearchParams = new URLSearchParams({ limit: '100', ...(cursor ? { cursor } : {}) });
    const page: { items: T[]; nextCursor?: string | null } = await request(`${path}?${query}`);
    items.push(...page.items); cursor = page.nextCursor || null;
    if (cursor && visited.has(cursor)) throw new ApiError('INVALID_CURSOR', '목록을 다시 불러와 주세요.');
    if (cursor) visited.add(cursor);
  } while (cursor);
  return items;
}
function headers(operation: Operation, mutate = false) { return { 'X-Account-Operation-Token': operation.operationToken, ...(mutate ? { 'Idempotency-Key': operation.confirmKey } : {}) }; }
async function saveOperation(operation: Operation) { await secureStorage.setItemAsync(`itda.operation.${operation.id}`, json(operation)); }
async function loadOperation(id: string): Promise<Operation> {
  const value = await secureStorage.getItemAsync(`itda.operation.${id}`);
  if (!value) throw new ApiError('OPERATION_NOT_FOUND', '이 기기에서 시작한 계정 작업을 찾지 못했습니다. 다시 시작해 주세요.');
  return JSON.parse(value) as Operation;
}
async function methods(): Promise<LoginMethod[]> {
  const data = await request<{ methods: { id: string; provider: string }[]; canUnlink: boolean }>('/v1/me/login-methods');
  return data.methods.map(item => ({ ...item, canUnlink: data.canUnlink }));
}
async function reauthenticate(provider?: Provider) {
  const selected = provider ?? 'kakao';
  assertMobileLoginProvider(selected);
  requireNativeAccountFlow();
  const current = (await request<{ user: AppUser }>('/v1/account/session')).user;
  const available = await methods();
  if (!available.some(item => item.provider === selected)) throw new ApiError('LOGIN_METHOD_REQUIRED', '현재 계정에 연결된 카카오로 본인 확인을 해 주세요.');
  await signInWith(selected, { client: reauthClient, returnTo: '/account/login-methods' });
  const verified = (await request<{ user: AppUser }>('/v1/account/session', { client: reauthClient })).user;
  if (verified.id !== current.id) throw new ApiError('WRONG_ACCOUNT', '현재 사용 중인 계정과 다른 계정입니다. 연결된 계정으로 다시 본인 확인을 해 주세요.');
  return reauthClient;
}
function mergeView(wire: MergeWire, operation: Operation): MergePreview {
  const people = wire.users.map(person => ({ id: person.userId, name: person.name, role: person.role,
    isMemberVerified: person.isMemberVerified, status: 'active' as const, version: 0 }));
  const target = people.find(person => person.id === wire.targetUserId);
  const source = people.find(person => person.id === wire.sourceUserId);
  if (!target || !source) throw new ApiError('INVALID_MERGE_PREVIEW', '두 계정의 확인을 먼저 완료해 주세요.');
  const messages: Record<string, string> = {
    REGISTRATION_ANSWERS_CONFLICT: '두 계정의 수련회 신청 내용이 다릅니다. 운영자에게 확인한 뒤 다시 진행해 주세요.',
    REGISTRATION_NAME_CONFLICT: '두 신청의 이름이 다릅니다. 신청 이름을 정정한 뒤 다시 진행해 주세요.',
    REGISTRATION_STATE_CONFLICT: '취소된 신청에 출석 기록이 있습니다. 관리자 확인이 필요합니다.',
    ATTENDANCE_CONFLICT: '두 계정의 출석 기록이 다릅니다. 관리자에게 확인한 뒤 다시 진행해 주세요.',
    NAME_CONFLICT: '두 신청의 이름이 다릅니다. 신청 이름을 정정한 뒤 다시 진행해 주세요.',
    PARTICIPANT_NAME_CONFLICT: '두 신청의 이름이 다릅니다. 신청 이름을 정정한 뒤 다시 진행해 주세요.',
    CANCELLED_ATTENDANCE_CONFLICT: '취소된 신청에 출석 기록이 있습니다. 관리자 확인이 필요합니다.',
    PROVIDER_CONFLICT: '동일한 로그인 수단이 두 계정에 연결되어 있습니다. 관리자 확인이 필요합니다.',
  };
  const preview: MergePreview = { requestId: wire.id, expiresAt: operation.expiresAt, targetUser: target, sourceUser: source,
    methods: wire.loginMethods.map((method, index) => ({ id: `${method.userId}:${index}`, provider: method.provider, canUnlink: false })),
    registrationCount: wire.registrationCount, duplicateCount: wire.duplicateRegistrationCount,
    isMemberVerified: wire.isMemberVerified, requiresAdminApproval: wire.requiresAdminApproval && wire.status !== 'approved',
    conflicts: wire.conflicts.map(conflict => ({ eventId: conflict.eventId, title: conflict.eventTitle, code: conflict.code,
      message: conflict.message || messages[conflict.code] || '기록을 확인한 뒤 다시 진행해 주세요.' })),
    registrations: wire.registrationResults?.map(item => {
      const result = registration(item);
      if (!result.event && item.eventTitle) result.event = { id: item.eventId, title: item.eventTitle } as EventItem;
      return result;
    }), previewToken: wire.snapshotHash, status: 'prepared' };
  mergePreviews.set(wire.id, preview);
  return preview;
}
async function mergePreview(operation: Operation) {
  return mergeView(await request<MergeWire>(`/v1/account-merges/${pathId(operation.id)}/preview`, { headers: headers(operation) }), operation);
}

export const api = {
  async listEvents(filters?: EventFilters): Promise<EventItem[]> {
    const items: EventItem[] = [];
    let cursor: string | null = null;
    do {
      const query: URLSearchParams = new URLSearchParams({ limit: '100', ...(cursor ? { cursor } : {}) });
      const page: { items: WireEvent[]; nextCursor: string | null } = await request(`/v1/events?${query}`);
      items.push(...page.items.map(event)); cursor = page.nextCursor;
    } while (cursor);
    const now = Date.now(); const query = filters?.query?.trim().toLocaleLowerCase();
    return items.filter(item => (!filters?.category || filters.category === 'all' || item.category === filters.category)
      && (!query || `${item.title} ${item.description} ${item.location}`.toLocaleLowerCase().includes(query))
      && (!filters?.period || filters.period === 'all' || (filters.period === 'past'
        ? !!item.endsAt && new Date(item.endsAt).getTime() < now
        : !item.endsAt || new Date(item.endsAt).getTime() >= now)));
  },
  async getEvent(id: string) { return event((await request<{ event: WireEvent }>(`/v1/events/${pathId(id)}`)).event); },
  async register(eventId: string, input: { participantName: string; expectedEventVersion: number; expectedRegistrationVersion: number | null }) {
    return registration((await request<{ registration: WireRegistration }>(`/v1/events/${pathId(eventId)}/registrations`, { method: 'POST', body: json({ ...input, expectedRegistrationVersion: input.expectedRegistrationVersion ?? 0 }) })).registration);
  },
  async listMyRegistrations() { return (await listAll<WireRegistration>('/v1/me/registrations')).map(registration); },
  async cancelRegistration(id: string, expectedVersion: number) { return registration((await request<{ registration: WireRegistration }>(`/v1/me/registrations/${pathId(id)}`, { method: 'DELETE', body: json({ expectedVersion }) })).registration); },
  async updateRegistrationName(id: string, participantName: string, expectedVersion: number) { return registration((await request<{ registration: WireRegistration }>(`/v1/me/registrations/${pathId(id)}`, { method: 'PATCH', body: json({ participantName, expectedVersion }) })).registration); },
  async updateProfile(input: { name: string; peerGroup?: string | null; gender?: AppUser['gender']; phoneNumber?: string | null }) { return user((await request<{ user: AppUser }>('/v1/me', { method: 'PATCH', body: json(input) })).user); },
  async getRetreat(): Promise<RetreatDetail> {
    const { retreat } = await request<{ retreat: Omit<RetreatDetail, 'event'> & { event: WireEvent } }>('/v1/retreats/nehemiah-winter');
    return { ...retreat, event: event(retreat.event) };
  },
  async getMyRetreatRegistration(): Promise<RetreatRegistration | null> {
    const data = await request<{ registration: (WireRegistration & { retreatSlug: string; answers: RetreatRegistration['answers'] }) | null }>('/v1/me/retreats/nehemiah-winter/registration');
    return data.registration ? { ...registration(data.registration), retreatSlug: data.registration.retreatSlug, answers: data.registration.answers } : null;
  },
  async registerRetreat(input: RetreatRegistrationInput): Promise<RetreatRegistration> {
    const data = await request<{ registration: WireRegistration & { retreatSlug: string; answers: RetreatRegistration['answers'] } }>('/v1/retreats/nehemiah-winter/registrations', { method: 'POST', body: json(input) });
    return { ...registration(data.registration), retreatSlug: data.registration.retreatSlug, answers: data.registration.answers };
  },
  async requestMemberVerification() { return user((await request<{ user: AppUser }>('/v1/me/member-verification', { method: 'POST', body: '{}' })).user); },
  listLoginMethods: methods,
  async linkLoginMethod(provider: Provider) {
    assertMobileLoginProvider(provider);
    return runAccountFlow(async () => {
    const client = await reauthenticate();
    const result = await client.linkSocial({ provider, callbackURL: Linking.createURL('/auth/callback', { scheme: APP_SCHEME }) });
    if (result.error) throw new ApiError(result.error.code || 'LINK_FAILED', result.error.message || '로그인 수단을 연결하지 못했습니다.');
    const after = (await request<{ methods: { provider: string }[] }>('/v1/me/login-methods')).methods;
    if (!after.some(item => item.provider === provider)) throw new ApiError('LINK_NOT_COMPLETED', '연결이 완료되지 않았습니다. 이미 별도 계정이 있다면 계정 통합을 이용해 주세요.');
    });
  },
  async unlinkLoginMethod(id: string, providerToKeep: Provider) {
    assertMobileLoginProvider(providerToKeep);
    return runAccountFlow(async () => {
    const client = await reauthenticate(providerToKeep);
    await request(`/v1/me/login-methods/${pathId(id)}/unlink`, { method: 'POST', body: '{}', client });
    await signInWith(providerToKeep, { returnTo: '/account/login-methods' });
    });
  },
  async prepareMerge(provider: Provider) {
    assertMobileLoginProvider(provider);
    return runAccountFlow(async () => {
    const ownerClient = await reauthenticate();
    const prepared = await request<{ id: string; operationToken: string; expiresAt: string }>('/v1/account-merges/prepare', {
      method: 'POST', body: json({ provider }), client: ownerClient, headers: { 'Idempotency-Key': Crypto.randomUUID() } });
    const operation: Operation = { ...prepared, confirmKey: Crypto.randomUUID() }; await saveOperation(operation);
    await signInWith(provider, { proof: true, returnTo: `/account/merge?requestId=${operation.id}` });
    await request('/v1/account/session', { client: proofAuthClient });
    await request(`/v1/account-merges/${pathId(operation.id)}/prove`, { method: 'POST', body: '{}', client: proofAuthClient, headers: headers(operation) });
    return mergePreview(operation);
    });
  },
  async getMerge(requestId: string): Promise<MergePreview> {
    const operation = await loadOperation(requestId);
    const state = await request<{ status: string }>(`/v1/account-merges/${pathId(requestId)}/status`, { headers: headers(operation) });
    const previous = mergePreviews.get(requestId);
    if (['completed', 'cancelled', 'expired'].includes(state.status)) {
      if (previous) return { ...previous, status: state.status as 'completed' | 'cancelled' | 'expired' };
      throw new ApiError('OPERATION_FINISHED', state.status === 'completed' ? '통합이 완료되었습니다. 다시 로그인해 주세요.' : '종료된 요청입니다. 로그인 수단 화면에서 다시 시작해 주세요.');
    }
    return mergePreview(operation);
  },
  async approveMerge(preview: MergePreview) {
    return runAccountFlow(async () => {
    const client = await reauthenticate();
    await request(`/v1/admin/account-merges/${pathId(preview.requestId)}/approve`, { method: 'POST', client, body: json({ snapshotHash: preview.previewToken }) });
    return mergePreview(await loadOperation(preview.requestId));
    });
  },
  async confirmMerge(preview: MergePreview) {
    const operation = await loadOperation(preview.requestId);
    try { await request(`/v1/account-merges/${pathId(operation.id)}/confirm`, { method: 'POST', body: json({ snapshotHash: preview.previewToken, confirmed: true }), headers: headers(operation, true) }); }
    catch (reason) {
      if (!(reason instanceof ApiError) || reason.code !== 'NETWORK_ERROR') throw reason;
      const state = await request<{ status: string }>(`/v1/account-merges/${pathId(operation.id)}/status`, { headers: headers(operation) });
      if (state.status !== 'completed') throw reason;
    }
  },
  async cancelMerge(requestId: string) { const operation = await loadOperation(requestId); await request(`/v1/account-merges/${pathId(requestId)}/cancel`, { method: 'POST', body: '{}', headers: headers(operation) }); },
  async listAdminEvents() { return (await listAll<WireEvent>('/v1/admin/events')).map(event); },
  getEventSyncStatus() { return request<EventSyncStatus>('/v1/admin/event-sync'); },
  async runEventSync() {
    try { return await request<SyncResult>('/v1/admin/event-sync', { method: 'POST', body: '{}', timeoutMs: 35_000 }); }
    catch (reason) {
      if (reason instanceof ApiError && reason.code === 'NETWORK_ERROR') throw new ApiError('NETWORK_ERROR', '연결을 확인해 주세요. 주보 가져오기가 계속 진행될 수 있으니 실행 기록을 먼저 확인해 주세요.');
      throw reason;
    }
  },
  async setEventSyncMode(id: string, mode: 'manual' | 'automatic', expectedVersion: number) {
    return event((await request<{ event: WireEvent }>(`/v1/admin/events/${pathId(id)}/source-sync`, { method: 'PATCH', body: json({ mode, expectedVersion }) })).event);
  },
  async listEventSources() { return listAll<{ id: string; bulletinId: string; title: string; body: string; details: unknown[]; url: string | null }>('/v1/admin/event-sources'); },
  async saveEvent(input: EventInput) {
    const id = input.id;
    const body = writableEvent(input);
    return event((await request<{ event: WireEvent }>(id ? `/v1/admin/events/${pathId(id)}` : '/v1/admin/events', { method: id ? 'PATCH' : 'POST', body: json(body) })).event);
  },
  async listAdminUsers() { return (await listAll<AppUser>('/v1/admin/users')).map(user); },
  async verifyUser(id: string, isMemberVerified: boolean, expectedVersion: number) { return user((await request<{ user: AppUser }>(`/v1/admin/users/${pathId(id)}`, { method: 'PATCH', body: json({ isMemberVerified, expectedVersion }) })).user); },
  async listRoster(eventId: string) { return (await listAll<WireRegistration>(`/v1/admin/events/${pathId(eventId)}/registrations`)).map(registration); },
  async setAttendance(id: string, attendanceStatus: Registration['attendanceStatus'], expectedVersion: number) {
    const eventId = registrationEvents.get(id);
    if (!eventId) throw new ApiError('ROSTER_REQUIRED', '신청자 명단을 다시 불러와 주세요.');
    return registration((await request<{ registration: WireRegistration }>(`/v1/admin/events/${pathId(eventId)}/registrations/${pathId(id)}/attendance`, { method: 'PATCH', body: json({ attendanceStatus, expectedVersion }) })).registration);
  },
  async deleteAccount() {
    return runAccountFlow(async () => {
    const client = await reauthenticate();
    const prepared = await request<{ id: string; operationToken: string; expiresAt: string }>('/v1/me/delete/prepare', { method: 'POST', body: '{}', client, headers: { 'Idempotency-Key': Crypto.randomUUID() } });
    const operation: Operation = { ...prepared, confirmKey: Crypto.randomUUID() }; await saveOperation(operation);
    const preview = await request<{ snapshotHash: string }>(`/v1/me/delete/${pathId(operation.id)}/preview`, { client, headers: headers(operation) });
    try { await request(`/v1/me/delete/${pathId(operation.id)}/confirm`, { method: 'POST', client, body: json({ snapshotHash: preview.snapshotHash, confirmed: true }), headers: headers(operation, true) }); }
    catch (reason) {
      if (!(reason instanceof ApiError) || reason.code !== 'NETWORK_ERROR') throw reason;
      const state = await request<{ status: string }>(`/v1/me/delete/${pathId(operation.id)}/status`, { headers: headers(operation) });
      if (state.status !== 'completed') throw reason;
    }
    });
  },
};
export type ItdaApi = typeof api;
