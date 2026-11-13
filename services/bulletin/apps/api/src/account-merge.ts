export type MergeUser = {
  user_id: string;
  name: string;
  role: 'admin' | 'user';
  status: 'active' | 'merged' | 'deleting';
  is_member_verified: boolean;
  member_verification_revoked_at: string | Date | null;
  version: number;
  auth_version: number;
  peer_group?: string | null;
  gender?: string | null;
  phone_number?: string | null;
  [key: string]: unknown;
};

export type MergeRegistration = {
  id: string;
  event_id: string;
  user_id: string;
  status: 'confirmed' | 'cancelled';
  attendance_status: 'unmarked' | 'present' | 'absent';
  version: number;
  retreat_answers?: Record<string, unknown> | null;
  [key: string]: unknown;
};

export type AuthAccount = { id: string; userId: string; providerId: string; accountId: string };
export type MergeSnapshot = {
  users: MergeUser[];
  accounts: AuthAccount[];
  events: Record<string, unknown>[];
  registrations: MergeRegistration[];
};
export type RegistrationMergeAction = {
  eventId: string;
  keepId: string;
  removeId: string | null;
  attendanceStatus: MergeRegistration['attendance_status'];
  attendanceFromId: string;
};
export type MergePlan = {
  targetUserId: string;
  sourceUserId: string;
  requiresAdminApproval: boolean;
  memberVerified: boolean;
  memberVerificationRevokedAt: string | null;
  profile: { peerGroup: string | null; gender: string | null; phoneNumber: string | null };
  actions: RegistrationMergeAction[];
  conflicts: { eventId: string; code: 'ATTENDANCE_CONFLICT' | 'REGISTRATION_NAME_CONFLICT' | 'REGISTRATION_STATE_CONFLICT' | 'REGISTRATION_ANSWERS_CONFLICT' }[];
};

function timestamp(value: string | Date | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

/** Pure policy: the administrator's existing internal ID survives the merge. */
export function buildMergePlan(snapshot: MergeSnapshot, requestedTargetUserId: string): MergePlan {
  if (snapshot.users.length !== 2 || new Set(snapshot.users.map((u) => u.user_id)).size !== 2) {
    throw new Error('A merge requires two distinct users.');
  }
  if (snapshot.users.some((user) => user.status !== 'active')) throw new Error('Both users must be active.');
  const requestedTarget = snapshot.users.find((user) => user.user_id === requestedTargetUserId);
  if (!requestedTarget) throw new Error('The target must be one of the proven users.');
  const admins = snapshot.users.filter((user) => user.role === 'admin');
  const target = admins.length === 1 ? admins[0] : requestedTarget;
  const source = snapshot.users.find((user) => user.user_id !== target.user_id)!;
  const profileValue = (primary: string | null | undefined, secondary: string | null | undefined) =>
    [primary, secondary].find((value): value is string => typeof value === 'string' && value.trim() !== '') ?? null;
  const revocations = snapshot.users.map((user) => timestamp(user.member_verification_revoked_at))
    .filter((value): value is string => value !== null).sort();
  const grouped = new Map<string, MergeRegistration[]>();
  for (const registration of snapshot.registrations) {
    if (!snapshot.users.some((user) => user.user_id === registration.user_id)) throw new Error('Unrelated registration.');
    const group = grouped.get(registration.event_id) ?? [];
    group.push(registration);
    grouped.set(registration.event_id, group);
  }
  const actions: RegistrationMergeAction[] = [];
  const conflicts: MergePlan['conflicts'] = [];
  for (const [eventId, records] of [...grouped].sort(([a], [b]) => a.localeCompare(b))) {
    if (records.length > 2 || new Set(records.map((record) => record.user_id)).size !== records.length) {
      throw new Error('Duplicate registrations must be repaired before merging.');
    }
    const marked = records.filter((record) => record.attendance_status !== 'unmarked');
    const participantNames = records.map((record) => record.participant_name)
      .filter((name): name is string => typeof name === 'string' && !!name.trim())
      .map((name) => name.trim().normalize('NFC'));
    if (new Set(participantNames).size > 1) conflicts.push({ eventId, code: 'REGISTRATION_NAME_CONFLICT' });
    if (records.some((record) => record.status === 'cancelled' && record.attendance_status !== 'unmarked')) {
      conflicts.push({ eventId, code: 'REGISTRATION_STATE_CONFLICT' });
    }
    if (new Set(marked.map((record) => record.attendance_status)).size > 1) {
      conflicts.push({ eventId, code: 'ATTENDANCE_CONFLICT' });
    }
    const confirmed = records.filter((record) => record.status === 'confirmed');
    if (confirmed.length > 1 && new Set(confirmed.map((record) => JSON.stringify(canonical(record.retreat_answers ?? null)))).size > 1) {
      conflicts.push({ eventId, code: 'REGISTRATION_ANSWERS_CONFLICT' });
    }
    // Active registration wins. Ties retain the target's existing registration/code.
    const ranked = [...records].sort((a, b) => Number(b.status === 'confirmed') - Number(a.status === 'confirmed')
      || Number(b.user_id === target.user_id) - Number(a.user_id === target.user_id) || a.id.localeCompare(b.id));
    const winner = ranked[0];
    const attendance = marked.find((record) => record.id === winner.id) ?? marked[0] ?? winner;
    actions.push({ eventId, keepId: winner.id, removeId: ranked[1]?.id ?? null,
      attendanceStatus: attendance.attendance_status, attendanceFromId: attendance.id });
  }
  return { targetUserId: target.user_id, sourceUserId: source.user_id, requiresAdminApproval: admins.length > 0,
    memberVerified: revocations.length === 0 && snapshot.users.some((user) => user.is_member_verified),
    memberVerificationRevokedAt: revocations.at(-1) ?? null,
    profile: { peerGroup: profileValue(target.peer_group, source.peer_group), gender: profileValue(target.gender, source.gender),
      phoneNumber: profileValue(target.phone_number, source.phone_number) }, actions, conflicts };
}

function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => [key, canonical(item)]));
  return value;
}

export async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Hash the entire current set, not merely rows present in an earlier preview. */
export function hashMergeSnapshot(snapshot: MergeSnapshot): Promise<string> {
  const normalized = { users: [...snapshot.users].sort((a, b) => a.user_id.localeCompare(b.user_id)),
    accounts: [...snapshot.accounts].sort((a, b) => a.id.localeCompare(b.id)),
    events: [...snapshot.events].sort((a, b) => String(a.id).localeCompare(String(b.id))),
    registrations: [...snapshot.registrations].sort((a, b) => a.id.localeCompare(b.id)) };
  return sha256(JSON.stringify(canonical(normalized)));
}

export function recentProof(createdAt: string | Date, now = Date.now()): boolean {
  const age = now - new Date(createdAt).getTime();
  return Number.isFinite(age) && age >= -30_000 && age <= 5 * 60_000;
}

export function constantTimeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let diff = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}
