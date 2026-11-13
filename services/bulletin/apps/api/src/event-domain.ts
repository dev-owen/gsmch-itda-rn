import { HTTPException } from 'hono/http-exception';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { transaction } from './db.js';
import type { SourceFields } from './event-sync-types.js';
import { DEMO_EVENT_ID, RETREAT_SLUG } from './retreat-content.js';
import { profilePatchInput, retreatRegistrationInput } from './retreat-validation.js';
import type { Gender, RetreatAnswers } from './retreat-types.js';

export class EventError extends HTTPException {
  readonly code: string;
  constructor(status: 400 | 401 | 403 | 404 | 409 | 422, code: string, message: string) {
    super(status, { message, res: Response.json({ code, message }, { status, headers: { 'Cache-Control': 'no-store' } }) });
    this.code = code;
  }
}

export type MemberRow = {
  user_id: string; name: string; role: 'admin' | 'user'; is_member_verified: boolean;
  member_verification_revoked_at: Date | string | null; verification_requested_at: Date | string | null;
  status: 'active' | 'merged' | 'deleting'; merged_into_user_id: string | null; version: number; auth_version: number;
  peer_group?: string | null; gender?: Gender | null; phone_number?: string | null;
};
export type Actor = { userId: string; authVersion: number };
export type EventRow = {
  id: string; title: string; category: 'event' | 'recruitment'; description: string; member_details: string;
  location: string; target: string; starts_at: Date | string | null; ends_at: Date | string | null; all_day: boolean;
  visibility: 'public' | 'members'; requires_member_verification: boolean;
  publication_status: 'draft' | 'published' | 'hidden'; lifecycle_status: 'active' | 'cancelled' | 'completed';
  registration_enabled: boolean; registration_opens_at: Date | string | null; registration_closes_at: Date | string | null;
  cancellation_closes_at: Date | string | null; source_promotion_id: string | null;
  version: number; created_at: Date | string; updated_at: Date | string; cancelled_at: Date | string | null;
  completed_at: Date | string | null; server_now?: Date | string;
  source_system?: string | null; source_id?: string | null; source_identity_key?: string | null;
  source_snapshot_identity_key?: string | null; source_bulletin_id?: string | null; source_bulletin_date?: string | null;
  source_url?: string | null; sync_mode?: 'manual' | 'automatic'; source_snapshot?: SourceFields | null;
  source_review_required?: boolean; source_warnings?: string[]; source_pending?: boolean; source_missing?: boolean;
  source_synced_at?: Date | string | null; source_sync_error?: string | null;
  is_demo?: boolean;
};
export type RegistrationRow = {
  id: string; event_id: string; user_id: string; participant_name: string; status: 'confirmed' | 'cancelled';
  attendance_status: 'unmarked' | 'present' | 'absent'; version: number; confirmation_code: string;
  confirmed_at: Date | string; cancelled_at: Date | string | null; checked_by: string | null;
  checked_at: Date | string | null; created_at: Date | string; updated_at: Date | string;
  retreat_answers?: RetreatAnswers | null;
};

const name = z.string().trim().min(1).refine((value) => [...value].length <= 50, '이름은 50자 이내로 입력해 주세요.').transform((value) => value.normalize('NFC'));
const time = z.iso.datetime({ offset: true }).nullable();
export const versionInput = z.number().int().min(1);
export const nameInput = name;
export const eventInput = z.object({
  title: z.string().trim().min(1).max(160), category: z.enum(['event', 'recruitment']).default('event'),
  description: z.string().trim().max(10000).default(''), memberDetails: z.string().trim().max(10000).default(''),
  location: z.string().trim().max(300).default(''), target: z.string().trim().max(300).default(''),
  startsAt: time.default(null), endsAt: time.default(null), allDay: z.boolean().default(false),
  visibility: z.enum(['public', 'members']).default('public'), requiresMemberVerification: z.boolean().default(false),
  publicationStatus: z.enum(['draft', 'published', 'hidden']).default('draft'),
  lifecycleStatus: z.enum(['active', 'cancelled', 'completed']).default('active'),
  registrationEnabled: z.boolean().default(false), registrationOpensAt: time.default(null),
  registrationClosesAt: time.default(null), cancellationClosesAt: time.default(null),
  sourcePromotionId: z.uuid().nullable().default(null), expectedVersion: versionInput.optional(),
}).strict().superRefine((event, context) => {
  const invalid = (path: string, message: string) => context.addIssue({ code: 'custom', path: [path], message });
  if (event.endsAt && (!event.startsAt || Date.parse(event.endsAt) < Date.parse(event.startsAt))) invalid('endsAt', '종료는 시작 이후로 설정해 주세요.');
  if (event.registrationEnabled && !event.registrationClosesAt) invalid('registrationClosesAt', '신청 마감을 입력해 주세요.');
  if (event.registrationEnabled && event.category === 'event' && !event.startsAt) invalid('startsAt', '일반 행사는 개최 일정을 정한 뒤 신청을 열어 주세요.');
  if (event.registrationOpensAt && event.registrationClosesAt && Date.parse(event.registrationOpensAt) >= Date.parse(event.registrationClosesAt)) invalid('registrationClosesAt', '신청 마감은 시작 이후로 설정해 주세요.');
  if (event.category === 'event' && event.startsAt && event.registrationClosesAt && Date.parse(event.registrationClosesAt) > Date.parse(event.startsAt)) invalid('registrationClosesAt', '신청 마감은 행사 시작을 넘길 수 없습니다.');
});
export type EventInput = z.infer<typeof eventInput>;
export const registrationInput = z.object({ participantName: name, expectedEventVersion: versionInput,
  expectedRegistrationVersion: z.number().int().min(0).default(0) }).strict();
export const cancellationInput = z.object({ expectedVersion: versionInput }).strict();
export const attendanceInput = z.object({ expectedVersion: versionInput, attendanceStatus: z.enum(['unmarked', 'present', 'absent']) }).strict();

export function iso(value: Date | string | null | undefined) { return value == null ? null : new Date(value).toISOString(); }
function millis(value: Date | string | null | undefined) { return value == null ? null : new Date(value).getTime(); }
export function registrationWindow(event: EventRow, at = new Date()): 'unavailable' | 'cancelled' | 'completed' | 'disabled' | 'upcoming' | 'closed' | 'open' {
  if (event.publication_status !== 'published') return 'unavailable';
  if (event.lifecycle_status === 'cancelled') return 'cancelled';
  if (event.lifecycle_status === 'completed') return 'completed';
  if (!event.registration_enabled) return 'disabled';
  const now = at.getTime(), opens = millis(event.registration_opens_at), closes = millis(event.registration_closes_at);
  if (opens !== null && now < opens) return 'upcoming';
  if (closes === null || now >= closes) return 'closed';
  return 'open';
}

// Deliberately construct both representations: database rows never become API objects by spreading.
export function publicEvent(event: EventRow, at = new Date()) {
  return { id: event.id, title: event.title, category: event.category, description: event.description,
    location: event.location, target: event.target, startsAt: iso(event.starts_at), endsAt: iso(event.ends_at), allDay: event.all_day,
    visibility: event.visibility, requiresMemberVerification: event.requires_member_verification,
    publicationStatus: event.publication_status, lifecycleStatus: event.lifecycle_status,
    registrationStatus: registrationWindow(event, at), registrationOpensAt: iso(event.registration_opens_at),
    registrationClosesAt: iso(event.registration_closes_at), cancellationClosesAt: iso(event.cancellation_closes_at), version: event.version,
    isDemo: !!event.is_demo, ...(event.id === DEMO_EVENT_ID ? { retreatSlug: RETREAT_SLUG } : {}),
    ...(event.source_url ? { sourceUrl: event.source_url } : {}) };
}
export function memberEvent(event: EventRow, at = new Date()) { return { ...publicEvent(event, at), memberDetails: event.member_details }; }
export function adminEvent(event: EventRow) { return { ...memberEvent(event), registrationEnabled: event.registration_enabled,
  sourcePromotionId: event.source_promotion_id, createdAt: iso(event.created_at), updatedAt: iso(event.updated_at),
  source: { kind: event.source_system ? 'bulletin' as const : 'manual' as const,
    syncMode: event.sync_mode || 'manual', lastSyncedAt: iso(event.source_synced_at), missing: !!event.source_missing,
    pending: !!event.source_pending, latest: event.source_snapshot || null, url: event.source_url || null,
    warnings: [...(event.source_warnings || []), ...(event.source_sync_error ? [event.source_sync_error] : [])] } }; }

/** Exact input allowlist: admin metadata must never enter the strict event-write schema. */
export function editableEvent(event: EventRow): EventInput {
  return { ...sourceFieldsFromEvent(event), memberDetails: event.member_details, visibility: event.visibility,
    requiresMemberVerification: event.requires_member_verification, publicationStatus: event.publication_status,
    lifecycleStatus: event.lifecycle_status, registrationEnabled: event.registration_enabled,
    registrationOpensAt: iso(event.registration_opens_at), registrationClosesAt: iso(event.registration_closes_at),
    cancellationClosesAt: iso(event.cancellation_closes_at), sourcePromotionId: event.source_promotion_id };
}
export function sourceFieldsFromEvent(event: EventRow): SourceFields {
  return { title: event.title, category: event.category, description: event.description, location: event.location,
    target: event.target, startsAt: iso(event.starts_at), endsAt: iso(event.ends_at), allDay: event.all_day };
}
export function normalizedSourceFields(fields: SourceFields): SourceFields {
  return { title: fields.title, category: fields.category, description: fields.description, location: fields.location,
    target: fields.target, startsAt: iso(fields.startsAt), endsAt: iso(fields.endsAt), allDay: fields.allDay };
}
export function sameSourceFields(a: SourceFields, b: SourceFields) {
  return JSON.stringify(normalizedSourceFields(a)) === JSON.stringify(normalizedSourceFields(b));
}
export async function updateEventForAdmin(pool: Pool, actor: Actor, id: string, body: unknown): Promise<EventRow> {
  return transaction(pool, async (client) => {
    const admin = ensureActiveMember((await lockMembers(client, [actor.userId]))[0], actor);
    if (admin.role !== 'admin') throw new EventError(403, 'FORBIDDEN', '관리자 권한이 필요합니다.');
    const current = (await client.query<EventRow>('SELECT * FROM events WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!current) throw new EventError(404, 'NOT_FOUND', '행사를 찾을 수 없습니다.');
    const input = eventInput.parse({ ...editableEvent(current), ...z.record(z.string(), z.unknown()).parse(body) });
    if (input.expectedVersion !== current.version) throw new EventError(409, 'EVENT_CHANGED', '변경된 행사를 다시 확인해 주세요.');
    if (current.lifecycle_status !== 'active' && input.lifecycleStatus !== current.lifecycle_status) throw new EventError(409, 'EVENT_CLOSED', '취소·종료한 행사를 다시 열 수 없습니다.');
    const sourceEdited = !!current.source_system && !sameSourceFields(sourceFieldsFromEvent(current), input);
    const sourcePending = !!current.source_snapshot && (!sameSourceFields(current.source_snapshot, input) || !!current.source_review_required);
    return (await client.query<EventRow>(`UPDATE events SET title=$2,category=$3,description=$4,member_details=$5,
      location=$6,target=$7,starts_at=$8,ends_at=$9,all_day=$10,visibility=$11,requires_member_verification=$12,
      publication_status=$13,lifecycle_status=$14,registration_enabled=$15,registration_opens_at=$16,
      registration_closes_at=$17,cancellation_closes_at=$18,source_promotion_id=$19,version=version+1,updated_at=now(),
      cancelled_at=CASE WHEN $14='cancelled' THEN COALESCE(cancelled_at,now()) ELSE cancelled_at END,
      completed_at=CASE WHEN $14='completed' THEN COALESCE(completed_at,now()) ELSE completed_at END,
      sync_mode=CASE WHEN $20 THEN 'manual' ELSE sync_mode END,
      source_pending=CASE WHEN $20 THEN $21 ELSE source_pending END,
      source_sync_error=CASE WHEN $20 THEN CASE WHEN $21 THEN 'MANUAL_CHANGES' ELSE NULL END ELSE source_sync_error END
      WHERE id=$1 RETURNING *`, [id, input.title, input.category, input.description, input.memberDetails,
      input.location, input.target, input.startsAt, input.endsAt, input.allDay, input.visibility, input.requiresMemberVerification,
      input.publicationStatus, input.lifecycleStatus, input.registrationEnabled, input.registrationOpensAt,
      input.registrationClosesAt, input.cancellationClosesAt, input.sourcePromotionId, sourceEdited, sourcePending])).rows[0];
  });
}
export function registrationView(row: RegistrationRow, event?: EventRow) {
  const answers = retreatAnswersView(row.retreat_answers);
  return { id: row.id, eventId: row.event_id, participantName: row.participant_name, status: row.status,
    effectiveStatus: event?.lifecycle_status === 'cancelled' ? 'event_cancelled' : row.status,
    attendanceStatus: row.attendance_status, confirmationCode: row.confirmation_code, version: row.version,
    confirmedAt: iso(row.confirmed_at), cancelledAt: iso(row.cancelled_at), checkedAt: iso(row.checked_at),
    ...(event ? { event: publicEvent(event) } : {}), ...(answers ? { retreatSlug: RETREAT_SLUG, answers } : {}) };
}
/** Answer fields are only attached to authenticated owner/admin registration responses. */
export function retreatAnswersView(raw: unknown): RetreatAnswers | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const parsed = retreatRegistrationInput.safeParse({ participantName: '답변', expectedEventVersion: 1, expectedRegistrationVersion: 0,
    peerGroup: value.peerGroup, gender: value.gender, phoneNumber: value.phoneNumber,
    departureOption: value.departureOption, departureNote: value.departureNote, prayerRequest: value.prayerRequest });
  if (!parsed.success) return null;
  const { peerGroup, gender, phoneNumber, departureOption, departureNote, prayerRequest } = parsed.data;
  return { peerGroup, gender, phoneNumber, departureOption, departureNote, prayerRequest };
}
export function memberView(row: MemberRow) { return { id: row.user_id, name: row.name, role: row.role,
  isMemberVerified: row.is_member_verified, verificationRequestedAt: iso(row.verification_requested_at), version: row.version,
  peerGroup: row.peer_group || null, gender: row.gender || null, phoneNumber: row.phone_number || null }; }

export async function updateMemberProfile(pool: Pool, actor: Actor, body: unknown): Promise<MemberRow> {
  const input = profilePatchInput.parse(body);
  return transaction(pool, async (client) => {
    ensureActiveMember((await lockMembers(client, [actor.userId]))[0], actor);
    const fields = { name: 'name', peerGroup: 'peer_group', gender: 'gender', phoneNumber: 'phone_number' } as const;
    const keys = Object.keys(input) as Array<keyof typeof fields>;
    const parameters = [actor.userId, ...keys.map((key) => input[key])];
    const assignments = keys.map((key, index) => `${fields[key]}=$${index + 2}`).join(',');
    return (await client.query<MemberRow>(`UPDATE app_users SET ${assignments},version=version+1,updated_at=now() WHERE user_id=$1 RETURNING *`, parameters)).rows[0];
  });
}

export function ensureActiveMember(row: MemberRow | undefined, actor?: Actor) {
  if (!row || row.status !== 'active') throw new EventError(401, 'ACCOUNT_UNAVAILABLE', '계정을 다시 확인해 주세요.');
  if (actor && row.auth_version !== actor.authVersion) throw new EventError(401, 'SESSION_EXPIRED', '다시 로그인해 주세요.');
  return row;
}
export function assertCanRegister(event: EventRow, member: MemberRow, expectedEventVersion: number, at: Date) {
  if (event.version !== expectedEventVersion) throw new EventError(409, 'EVENT_CHANGED', '변경된 행사 정보를 확인해 주세요.');
  if (registrationWindow(event, at) !== 'open') throw new EventError(409, 'REGISTRATION_CLOSED', '현재 신청할 수 없는 행사입니다.');
  if ((event.visibility === 'members' || event.requires_member_verification) && !member.is_member_verified) throw new EventError(403, 'MEMBER_VERIFICATION_REQUIRED', '성도 인증 후 신청할 수 있습니다.');
}
function checkVersion(row: RegistrationRow, version: number) {
  if (row.version !== version) throw new EventError(409, 'REGISTRATION_CHANGED', '변경된 신청 상태를 다시 확인해 주세요.');
}
export async function lockMembers(client: PoolClient, ids: string[]) {
  return (await client.query<MemberRow>('SELECT * FROM app_users WHERE user_id = ANY($1::text[]) ORDER BY user_id FOR UPDATE', [[...new Set(ids)].sort()])).rows;
}
async function lockEvent(client: PoolClient, id: string) {
  const event = (await client.query<EventRow>('SELECT *, clock_timestamp() AS server_now FROM events WHERE id = $1 FOR UPDATE', [id])).rows[0];
  if (!event) throw new EventError(404, 'NOT_FOUND', '행사를 찾을 수 없습니다.');
  return event;
}
async function lockedRegistration(client: PoolClient, actor: Actor, id: string) {
  const reference = (await client.query<RegistrationRow>('SELECT * FROM registrations WHERE id = $1', [id])).rows[0];
  if (!reference) throw new EventError(404, 'NOT_FOUND', '신청을 찾을 수 없습니다.');
  const users = await lockMembers(client, [actor.userId, reference.user_id]);
  const current = ensureActiveMember(users.find((row) => row.user_id === actor.userId), actor);
  if (reference.user_id !== actor.userId && current.role !== 'admin') throw new EventError(403, 'FORBIDDEN', '본인의 신청만 변경할 수 있습니다.');
  const event = await lockEvent(client, reference.event_id);
  const row = (await client.query<RegistrationRow>('SELECT * FROM registrations WHERE id = $1 FOR UPDATE', [id])).rows[0];
  if (!row || row.user_id !== reference.user_id || row.event_id !== reference.event_id) throw new EventError(409, 'REGISTRATION_CHANGED', '변경된 신청을 다시 확인해 주세요.');
  return { member: current, row, event };
}

export async function registerForEvent(pool: Pool, actor: Actor, eventId: string, input: z.infer<typeof registrationInput>) {
  return transaction(pool, async (client) => {
    const member = ensureActiveMember((await lockMembers(client, [actor.userId]))[0], actor);
    const event = await lockEvent(client, eventId);
    if (event.id === DEMO_EVENT_ID) throw new EventError(409, 'RETREAT_FORM_REQUIRED', '수련회 전용 신청서를 작성해 주세요.');
    assertCanRegister(event, member, input.expectedEventVersion, new Date(event.server_now!));
    const current = (await client.query<RegistrationRow>('SELECT * FROM registrations WHERE event_id = $1 AND user_id = $2 FOR UPDATE', [eventId, actor.userId])).rows[0];
    if (current?.status === 'confirmed') return { registration: current, event };
    if ((current?.version ?? 0) !== input.expectedRegistrationVersion) throw new EventError(409, 'REGISTRATION_CHANGED', '현재 신청 상태를 확인한 뒤 다시 신청해 주세요.');
    const result = current
      ? await client.query<RegistrationRow>(`UPDATE registrations SET status = 'confirmed', participant_name = $2,
          attendance_status = 'unmarked', version = version + 1, confirmed_at = now(), cancelled_at = NULL,
          checked_by = NULL, checked_at = NULL, confirmation_code = upper(encode(gen_random_bytes(6), 'hex')), updated_at = now()
          WHERE id = $1 RETURNING *`, [current.id, input.participantName])
      : await client.query<RegistrationRow>(`INSERT INTO registrations (event_id, user_id, participant_name) VALUES ($1,$2,$3) RETURNING *`, [eventId, actor.userId, input.participantName]);
    await client.query('UPDATE app_users SET version = version + 1, updated_at = now() WHERE user_id = $1', [actor.userId]);
    return { registration: result.rows[0], event };
  });
}
export async function cancelRegistration(pool: Pool, actor: Actor, id: string, expectedVersion: number) {
  return transaction(pool, async (client) => {
    const { member, row, event } = await lockedRegistration(client, actor, id);
    if (row.status === 'cancelled') return { registration: row, event };
    checkVersion(row, expectedVersion);
    if (member.role !== 'admin') {
      if (row.attendance_status !== 'unmarked') throw new EventError(409, 'ATTENDANCE_LOCKED', '출석 처리 후에는 운영자에게 문의해 주세요.');
      const deadline = millis(event.cancellation_closes_at ?? event.starts_at ?? event.registration_closes_at);
      if (event.lifecycle_status !== 'cancelled' && deadline !== null && new Date(event.server_now!).getTime() >= deadline) throw new EventError(409, 'CANCELLATION_CLOSED', '취소 가능 기간이 지났습니다.');
    }
    const result = await client.query<RegistrationRow>(`UPDATE registrations SET status = 'cancelled', cancelled_at = now(),
      attendance_status = 'unmarked', checked_by = NULL, checked_at = NULL, version = version + 1, updated_at = now() WHERE id = $1 RETURNING *`, [id]);
    await client.query('UPDATE app_users SET version = version + 1, updated_at = now() WHERE user_id = $1', [row.user_id]);
    return { registration: result.rows[0], event };
  });
}
export async function correctParticipantName(pool: Pool, actor: Actor, id: string, participantName: string, expectedVersion: number) {
  return transaction(pool, async (client) => {
    const { member, row, event } = await lockedRegistration(client, actor, id);
    if (row.retreat_answers || event.id === DEMO_EVENT_ID) throw new EventError(409, 'RETREAT_PROFILE_LOCKED', '수련회 신청 정보는 전용 신청 화면에서 확인해 주세요.');
    checkVersion(row, expectedVersion);
    if (row.status !== 'confirmed') throw new EventError(409, 'REGISTRATION_CHANGED', '유효한 신청의 이름만 정정할 수 있습니다.');
    if (row.attendance_status !== 'unmarked' && member.role !== 'admin') throw new EventError(409, 'ATTENDANCE_LOCKED', '출석 처리 후에는 운영자에게 문의해 주세요.');
    const result = await client.query<RegistrationRow>('UPDATE registrations SET participant_name = $2, version = version + 1, updated_at = now() WHERE id = $1 RETURNING *', [id, participantName]);
    await client.query('UPDATE app_users SET version = version + 1, updated_at = now() WHERE user_id = $1', [row.user_id]);
    return { registration: result.rows[0], event };
  });
}
export async function setAttendance(pool: Pool, actor: Actor, id: string, input: z.infer<typeof attendanceInput>) {
  return transaction(pool, async (client) => {
    const { member, row, event } = await lockedRegistration(client, actor, id);
    if (member.role !== 'admin') throw new EventError(403, 'FORBIDDEN', '관리자 권한이 필요합니다.');
    checkVersion(row, input.expectedVersion);
    if (row.status !== 'confirmed' || event.lifecycle_status === 'cancelled') throw new EventError(409, 'ATTENDANCE_LOCKED', '취소된 신청이나 행사는 출석 처리할 수 없습니다.');
    const result = await client.query<RegistrationRow>(`UPDATE registrations SET attendance_status = $2,
      checked_by = $3, checked_at = now(), version = version + 1, updated_at = now() WHERE id = $1 RETURNING *`, [id, input.attendanceStatus, actor.userId]);
    await client.query('UPDATE app_users SET version = version + 1, updated_at = now() WHERE user_id = $1', [row.user_id]);
    return { registration: result.rows[0], event };
  });
}
