import type { Pool, PoolClient } from 'pg';
import { transaction } from './db.js';
import { buildMergePlan, constantTimeEqual, hashMergeSnapshot, recentProof, sha256,
  type AuthAccount, type MergeSnapshot, type MergeUser, type MergeRegistration, type MergePlan } from './account-merge.js';
import type { AppMember } from './event-users';

export class AccountError extends Error {
  constructor(public status: 400 | 401 | 403 | 404 | 409 | 410 | 422 | 428 | 503, public code: string, message: string) { super(message); }
}
export type SessionProof = { userId: string; sessionId: string; authVersion: number; provider: string; createdAt: string };
type Approval = { proof: SessionProof; snapshotHash: string };
type OperationData = {
  ownerProof: SessionProof;
  expectedProvider?: string;
  sourceProof?: SessionProof;
  snapshotHash?: string;
  approval?: Approval;
  confirmationKey?: string;
  result?: Record<string, unknown>;
  audit?: unknown;
};
export type AccountOperation = {
  id: string; kind: 'merge' | 'delete'; owner_user_id: string; source_user_id: string | null;
  request_key: string; token_hash: string; status: 'pending' | 'ready' | 'awaiting_approval' | 'approved' | 'completed' | 'cancelled';
  data: OperationData; expires_at: Date | string;
};
type SessionRow = { id: string; userId: string; createdAt: Date | string; authVersion: number; authProviderId: string };

export async function operationToken(secret: string, id: string): Promise<string> {
  if (!secret) throw new AccountError(503, 'AUTH_CONFIGURATION_REQUIRED', '인증 서버 설정이 필요합니다.');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const value = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`account-operation:v1:${id}`));
  return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function verifyOperationToken(operation: AccountOperation, token: string): Promise<void> {
  if (!token || !constantTimeEqual(await sha256(token), operation.token_hash)) {
    throw new AccountError(403, 'INVALID_OPERATION_PROOF', '계정 작업 확인 정보가 올바르지 않습니다.');
  }
}

export function ensurePending(operation: AccountOperation) {
  if (operation.status === 'completed' || operation.status === 'cancelled') {
    throw new AccountError(409, 'OPERATION_CLOSED', '이미 종료된 계정 작업입니다.');
  }
  if (new Date(operation.expires_at).getTime() <= Date.now()) throw new AccountError(410, 'OPERATION_EXPIRED', '계정 확인이 만료되었습니다. 다시 시작해 주세요.');
}

export async function readOperation(db: Pick<PoolClient, 'query'>, id: string, lock = false): Promise<AccountOperation> {
  const result = await db.query<AccountOperation>(`SELECT * FROM auth_account_operations WHERE id=$1${lock ? ' FOR UPDATE' : ''}`, [id]);
  if (!result.rows[0]) throw new AccountError(404, 'OPERATION_NOT_FOUND', '계정 작업을 찾을 수 없습니다.');
  return result.rows[0];
}

/** A recent OAuth-created server session, never a user ID or provider supplied in JSON. */
export async function readRecentProof(db: Pick<PoolClient, 'query'>, actor: Pick<AppMember, 'userId' | 'sessionId' | 'authVersion'>): Promise<SessionProof> {
  const result = await db.query<SessionRow>(`SELECT id,"userId","createdAt","authVersion","authProviderId" FROM "session"
    WHERE id=$1 AND "userId"=$2 AND "expiresAt">now()`, [actor.sessionId, actor.userId]);
  const session = result.rows[0];
  if (!session || Number(session.authVersion) !== actor.authVersion || !recentProof(session.createdAt)) {
    throw new AccountError(428, 'RECENT_LOGIN_REQUIRED', '계정을 보호하기 위해 다시 로그인해 주세요.');
  }
  if (!['google', 'kakao', 'apple'].includes(session.authProviderId)) {
    throw new AccountError(428, 'OAUTH_PROOF_REQUIRED', '소셜 계정으로 다시 로그인해 주세요.');
  }
  return { userId: session.userId, sessionId: session.id, authVersion: Number(session.authVersion),
    provider: session.authProviderId, createdAt: new Date(session.createdAt).toISOString() };
}

async function verifyStoredProof(db: PoolClient, proof: SessionProof | undefined, users: MergeUser[]): Promise<void> {
  if (!proof) throw new AccountError(428, 'BOTH_ACCOUNTS_REQUIRED', '두 계정을 모두 다시 확인해 주세요.');
  const user = users.find((candidate) => candidate.user_id === proof.userId);
  if (!user || user.status !== 'active' || user.auth_version !== proof.authVersion) throw new AccountError(409, 'ACCOUNT_CHANGED', '계정 상태가 변경되었습니다. 다시 시작해 주세요.');
  await readRecentProof(db, proof);
}

/** All writers use USER -> EVENT -> REGISTRATION locks. USER locks protect the full set. */
export async function lockAccountSnapshot(client: PoolClient, ids: string[], extraLockIds: string[] = []): Promise<MergeSnapshot> {
  const lockIds = [...new Set([...ids, ...extraLockIds])].sort();
  const locked = await client.query<MergeUser>('SELECT * FROM app_users WHERE user_id=ANY($1::text[]) ORDER BY user_id FOR UPDATE', [lockIds]);
  const users = locked.rows.filter((user) => ids.includes(user.user_id));
  if (users.length !== new Set(ids).size || users.some((user) => user.status !== 'active')) {
    throw new AccountError(409, 'ACCOUNT_CHANGED', '사용할 수 없는 계정입니다. 다시 로그인해 주세요.');
  }
  const events = await client.query<Record<string, unknown>>(`SELECT e.* FROM events e WHERE EXISTS (
    SELECT 1 FROM registrations r WHERE r.event_id=e.id AND r.user_id=ANY($1::text[])) ORDER BY e.id FOR UPDATE OF e`, [ids]);
  const registrations = await client.query<MergeRegistration>(`SELECT * FROM registrations WHERE user_id=ANY($1::text[])
    ORDER BY event_id,id FOR UPDATE`, [ids]);
  const accounts = await client.query<AuthAccount>(`SELECT id,"userId","providerId","accountId" FROM "account"
    WHERE "userId"=ANY($1::text[]) ORDER BY id FOR UPDATE`, [ids]);
  return { users, events: events.rows, registrations: registrations.rows, accounts: accounts.rows };
}

export function previewFor(snapshot: MergeSnapshot, plan: MergePlan, snapshotHash: string) {
  const eventTitle = (eventId: string) => String(snapshot.events.find((event) => event.id === eventId)?.title ?? '행사');
  const conflictMessage = { ATTENDANCE_CONFLICT: '두 계정의 출석 기록이 다릅니다.',
    REGISTRATION_NAME_CONFLICT: '두 계정에 등록된 참가자 이름이 다릅니다.',
    REGISTRATION_STATE_CONFLICT: '취소된 신청에 출석 기록이 남아 있습니다.',
    REGISTRATION_ANSWERS_CONFLICT: '두 계정의 수련회 신청 내용이 다릅니다. 신청 내용을 확인한 후 다시 시도해 주세요.' };
  return { snapshotHash, targetUserId: plan.targetUserId, sourceUserId: plan.sourceUserId,
    users: snapshot.users.map((user) => ({ userId: user.user_id, name: user.name, role: user.role, isMemberVerified: user.is_member_verified })),
    loginMethods: snapshot.accounts.map((account) => ({ provider: account.providerId, userId: account.userId })),
    registrationCount: snapshot.registrations.length, resultingRegistrationCount: plan.actions.length,
    duplicateRegistrationCount: plan.actions.filter((action) => action.removeId).length,
    registrationResults: plan.actions.map((action) => {
      const winner = snapshot.registrations.find((registration) => registration.id === action.keepId)!;
      return { id: winner.id, eventId: winner.event_id, participantName: winner.participant_name,
        status: winner.status, attendanceStatus: action.attendanceStatus, confirmationCode: winner.confirmation_code,
        version: winner.version + 1, eventTitle: eventTitle(winner.event_id), hasRetreatAnswers: winner.retreat_answers != null };
    }),
    requiresAdminApproval: plan.requiresAdminApproval, isMemberVerified: plan.memberVerified,
    memberVerificationRevokedAt: plan.memberVerificationRevokedAt,
    conflicts: plan.conflicts.map((conflict) => ({ ...conflict, eventTitle: eventTitle(conflict.eventId), message: conflictMessage[conflict.code] })) };
}

function auditSnapshot(snapshot: MergeSnapshot) {
  // Audit only lifecycle decisions. Profiles, phone numbers and prayer requests
  // are not needed to explain a merge and must not gain a second stored copy.
  return { users: snapshot.users.map((user) => ({ user_id: user.user_id, role: user.role, status: user.status,
    is_member_verified: user.is_member_verified, member_verification_revoked_at: user.member_verification_revoked_at,
    version: user.version, auth_version: user.auth_version })),
    accounts: snapshot.accounts.map(({ accountId: _providerSubject, ...account }) => account),
    events: snapshot.events.map((event) => ({ id: event.id, version: event.version, lifecycle_status: event.lifecycle_status })),
    registrations: snapshot.registrations.map((registration) => ({ id: registration.id, event_id: registration.event_id,
      user_id: registration.user_id, status: registration.status, attendance_status: registration.attendance_status,
      version: registration.version, confirmation_code: registration.confirmation_code,
      confirmed_at: registration.confirmed_at, cancelled_at: registration.cancelled_at,
      checked_by: registration.checked_by, checked_at: registration.checked_at })) };
}

export async function prepareOperation(pool: Pool, actor: AppMember, kind: 'merge' | 'delete', requestKey: string, secret: string, expectedProvider?: string) {
  return transaction(pool, async (client) => {
    const locked = await client.query<MergeUser>('SELECT * FROM app_users WHERE user_id=$1 FOR UPDATE', [actor.userId]);
    if (!locked.rows[0] || locked.rows[0].status !== 'active' || locked.rows[0].auth_version !== actor.authVersion) {
      throw new AccountError(401, 'SESSION_REVOKED', '다시 로그인해 주세요.');
    }
    const proof = await readRecentProof(client, actor);
    const existing = await client.query<AccountOperation>('SELECT * FROM auth_account_operations WHERE owner_user_id=$1 AND kind=$2 AND request_key=$3 FOR UPDATE', [actor.userId, kind, requestKey]);
    if (existing.rows[0]) {
      const operation = existing.rows[0];
      if (operation.data.expectedProvider !== expectedProvider) throw new AccountError(409, 'IDEMPOTENCY_CONFLICT', '같은 요청 식별자로 다른 로그인 수단을 요청할 수 없습니다.');
      const token = await operationToken(secret, operation.id);
      await verifyOperationToken(operation, token);
      return { operation, token };
    }
    const id = crypto.randomUUID();
    const token = await operationToken(secret, id);
    const result = await client.query<AccountOperation>(`INSERT INTO auth_account_operations
      (id,kind,owner_user_id,request_key,token_hash,data) VALUES ($1,$2,$3,$4,$5,$6::jsonb) RETURNING *`,
    [id, kind, actor.userId, requestKey, await sha256(token), JSON.stringify({ ownerProof: proof, expectedProvider })]);
    return { operation: result.rows[0], token };
  });
}

export async function proveMerge(pool: Pool, id: string, token: string, actor: AppMember) {
  return transaction(pool, async (client) => {
    const operation = await readOperation(client, id, true);
    await verifyOperationToken(operation, token); ensurePending(operation);
    if (operation.kind !== 'merge') throw new AccountError(409, 'WRONG_OPERATION', '계정 통합 요청이 아닙니다.');
    const proof = await readRecentProof(client, actor);
    const data: OperationData = { ...operation.data, snapshotHash: undefined, approval: undefined };
    let sourceId = operation.source_user_id;
    if (actor.userId === operation.owner_user_id) data.ownerProof = proof;
    else {
      if (sourceId && sourceId !== actor.userId) throw new AccountError(409, 'PROOF_ACCOUNT_CHANGED', '처음 확인한 두 번째 계정으로 로그인해 주세요.');
      if (data.expectedProvider && proof.provider !== data.expectedProvider) throw new AccountError(409, 'PROOF_PROVIDER_MISMATCH', '선택한 로그인 수단으로 두 번째 계정을 확인해 주세요.');
      sourceId = actor.userId; data.sourceProof = proof;
    }
    await client.query(`UPDATE auth_account_operations SET source_user_id=$2,data=$3::jsonb,status='pending',updated_at=now() WHERE id=$1`,
      [id, sourceId, JSON.stringify(data)]);
    return { id, status: 'pending', bothAccountsProven: !!data.sourceProof };
  });
}

export async function previewMerge(pool: Pool, id: string, token: string, actor: AppMember) {
  return transaction(pool, async (client) => {
    const operation = await readOperation(client, id, true);
    await verifyOperationToken(operation, token); ensurePending(operation);
    if (operation.kind !== 'merge' || !operation.source_user_id) throw new AccountError(428, 'BOTH_ACCOUNTS_REQUIRED', '두 번째 계정으로 로그인해 계정을 확인해 주세요.');
    if (![operation.owner_user_id, operation.source_user_id].includes(actor.userId)) throw new AccountError(403, 'FORBIDDEN', '두 계정의 소유자만 확인할 수 있습니다.');
    const snapshot = await lockAccountSnapshot(client, [operation.owner_user_id, operation.source_user_id]);
    await verifyStoredProof(client, operation.data.ownerProof, snapshot.users);
    await verifyStoredProof(client, operation.data.sourceProof, snapshot.users);
    const plan = buildMergePlan(snapshot, operation.owner_user_id);
    const snapshotHash = await hashMergeSnapshot(snapshot);
    const unchanged = snapshotHash === operation.data.snapshotHash;
    const data = { ...operation.data, snapshotHash, approval: unchanged ? operation.data.approval : undefined };
    const status = plan.requiresAdminApproval ? data.approval ? 'approved' : 'awaiting_approval' : 'ready';
    await client.query('UPDATE auth_account_operations SET data=$2::jsonb,status=$3,updated_at=now() WHERE id=$1', [id, JSON.stringify(data), status]);
    return { id, status, ...previewFor(snapshot, plan, snapshotHash) };
  });
}

export async function approveMerge(pool: Pool, id: string, expectedHash: string, actor: AppMember) {
  if (actor.role !== 'admin') throw new AccountError(403, 'FORBIDDEN', '관리자 승인이 필요합니다.');
  return transaction(pool, async (client) => {
    const operation = await readOperation(client, id, true); ensurePending(operation);
    if (operation.kind !== 'merge' || !operation.source_user_id || !operation.data.snapshotHash) throw new AccountError(409, 'PREVIEW_REQUIRED', '두 계정의 통합 미리보기를 먼저 확인해 주세요.');
    const snapshot = await lockAccountSnapshot(client, [operation.owner_user_id, operation.source_user_id], [actor.userId]);
    const admin = (await client.query<MergeUser>('SELECT * FROM app_users WHERE user_id=$1', [actor.userId])).rows[0];
    if (!admin || admin.role !== 'admin' || admin.status !== 'active' || admin.auth_version !== actor.authVersion) throw new AccountError(403, 'FORBIDDEN', '관리자 권한이 변경되었습니다.');
    const snapshotHash = await hashMergeSnapshot(snapshot);
    if (snapshotHash !== expectedHash || snapshotHash !== operation.data.snapshotHash) throw new AccountError(409, 'PREVIEW_STALE', '정보가 변경되었습니다. 미리보기를 다시 확인해 주세요.');
    await verifyStoredProof(client, operation.data.ownerProof, snapshot.users);
    await verifyStoredProof(client, operation.data.sourceProof, snapshot.users);
    const proof = await readRecentProof(client, actor);
    const data = { ...operation.data, approval: { proof, snapshotHash } };
    await client.query("UPDATE auth_account_operations SET data=$2::jsonb,status='approved',updated_at=now() WHERE id=$1", [id, JSON.stringify(data)]);
    return { id, status: 'approved', snapshotHash };
  });
}

export async function confirmMerge(pool: Pool, id: string, token: string, actor: AppMember | null, expectedHash: string, requestKey: string) {
  return transaction(pool, async (client) => {
    const operation = await readOperation(client, id, true);
    await verifyOperationToken(operation, token);
    if (operation.status === 'completed') {
      if (operation.data.confirmationKey !== requestKey || operation.data.snapshotHash !== expectedHash) throw new AccountError(409, 'IDEMPOTENCY_CONFLICT', '이 요청은 다른 내용으로 이미 처리되었습니다.');
      return operation.data.result!;
    }
    ensurePending(operation);
    if (!actor || ![operation.owner_user_id, operation.source_user_id].includes(actor.userId)) throw new AccountError(403, 'FORBIDDEN', '확인한 계정으로 로그인해 주세요.');
    if (operation.kind !== 'merge' || !operation.source_user_id || !operation.data.snapshotHash) throw new AccountError(409, 'PREVIEW_REQUIRED', '계정 통합 미리보기가 필요합니다.');
    const approval = operation.data.approval;
    const snapshot = await lockAccountSnapshot(client, [operation.owner_user_id, operation.source_user_id], approval ? [approval.proof.userId] : []);
    const snapshotHash = await hashMergeSnapshot(snapshot);
    if (snapshotHash !== expectedHash || snapshotHash !== operation.data.snapshotHash) throw new AccountError(409, 'PREVIEW_STALE', '신청 또는 계정 정보가 변경되었습니다. 미리보기를 다시 확인해 주세요.');
    await verifyStoredProof(client, operation.data.ownerProof, snapshot.users);
    await verifyStoredProof(client, operation.data.sourceProof, snapshot.users);
    const plan = buildMergePlan(snapshot, operation.owner_user_id);
    if (plan.conflicts.length) throw new AccountError(409, plan.conflicts[0].code, '같은 행사의 신청 정보가 다릅니다. 담당자 확인 후 다시 시도해 주세요.');
    if (plan.requiresAdminApproval) {
      if (!approval || approval.snapshotHash !== snapshotHash) throw new AccountError(403, 'ADMIN_APPROVAL_REQUIRED', '관리자 계정이 포함된 통합은 관리자 승인이 필요합니다.');
      const reviewer = (await client.query<MergeUser>('SELECT * FROM app_users WHERE user_id=$1', [approval.proof.userId])).rows[0];
      if (!reviewer || reviewer.role !== 'admin' || reviewer.status !== 'active' || reviewer.auth_version !== approval.proof.authVersion) throw new AccountError(403, 'ADMIN_APPROVAL_REQUIRED', '관리자 승인을 다시 받아 주세요.');
      await readRecentProof(client, approval.proof);
    }
    for (const action of plan.actions) {
      const attendance = snapshot.registrations.find((registration) => registration.id === action.attendanceFromId)!;
      if (action.removeId) await client.query('DELETE FROM registrations WHERE id=$1', [action.removeId]);
      await client.query(`UPDATE registrations SET user_id=$2,attendance_status=$3,checked_by=$4,checked_at=$5,
        version=version+1,updated_at=now() WHERE id=$1`, [action.keepId, plan.targetUserId, action.attendanceStatus,
      attendance.checked_by ?? null, attendance.checked_at ?? null]);
    }
    // The account trigger takes the already-held USER locks and updates versions.
    await client.query('UPDATE "account" SET "userId"=$2,"updatedAt"=now() WHERE "userId"=$1', [plan.sourceUserId, plan.targetUserId]);
    await client.query(`UPDATE app_users SET is_member_verified=$2,member_verification_revoked_at=$3,
      peer_group=$4,gender=$5,phone_number=$6,
      version=version+1,auth_version=auth_version+1,updated_at=now() WHERE user_id=$1`,
    [plan.targetUserId, plan.memberVerified, plan.memberVerificationRevokedAt,
      plan.profile.peerGroup, plan.profile.gender, plan.profile.phoneNumber]);
    await client.query(`UPDATE app_users SET status='merged',merged_into_user_id=$2,name='',is_member_verified=false,
      peer_group=NULL,gender=NULL,phone_number=NULL,
      verification_requested_at=NULL,version=version+1,auth_version=auth_version+1,updated_at=now() WHERE user_id=$1`, [plan.sourceUserId, plan.targetUserId]);
    await client.query('DELETE FROM "session" WHERE "userId"=ANY($1::text[])', [[plan.targetUserId, plan.sourceUserId]]);
    // The source identity remains a tombstone, but must not retain profile data or
    // reserve an email that a later explicit sign-up may legitimately use.
    await client.query(`UPDATE "user" SET name='통합된 사용자',email=$2,"emailVerified"=false,image=NULL,"updatedAt"=now() WHERE id=$1`,
      [plan.sourceUserId, `${crypto.randomUUID()}@merged.invalid`]);
    // Never transfer an administrator grant to a different ID; the admin ID survives.
    await client.query('DELETE FROM admin_users WHERE user_id=$1', [plan.sourceUserId]);
    const result = { id, status: 'completed', primaryUserId: plan.targetUserId, reauthenticationRequired: true };
    const data = { ...operation.data, confirmationKey: requestKey, result, audit: { before: auditSnapshot(snapshot), actions: plan.actions,
      targetUserId: plan.targetUserId, sourceUserId: plan.sourceUserId, confirmedBy: actor.userId } };
    await client.query("UPDATE auth_account_operations SET status='completed',data=$2::jsonb,completed_at=now(),updated_at=now() WHERE id=$1", [id, JSON.stringify(data)]);
    return result;
  });
}

export async function unlinkLogin(pool: Pool, actor: AppMember, accountId: string) {
  return transaction(pool, async (client) => {
    const snapshot = await lockAccountSnapshot(client, [actor.userId]);
    const user = snapshot.users[0];
    if (user.auth_version !== actor.authVersion) throw new AccountError(401, 'SESSION_REVOKED', '다시 로그인해 주세요.');
    const proof = await readRecentProof(client, actor);
    const removed = snapshot.accounts.find((account) => account.id === accountId);
    if (!removed) throw new AccountError(404, 'LOGIN_METHOD_NOT_FOUND', '연결된 로그인 수단을 찾을 수 없습니다.');
    const remaining = snapshot.accounts.filter((account) => account.id !== accountId);
    if (!remaining.length) throw new AccountError(409, 'LAST_LOGIN_METHOD', '마지막 로그인 수단은 해제할 수 없습니다.');
    const requiredProvider = user.role === 'admin' ? 'google' : 'kakao';
    if (removed.providerId === requiredProvider && !remaining.some((account) => account.providerId === requiredProvider)) {
      throw new AccountError(409, 'REQUIRED_LOGIN_METHOD', user.role === 'admin'
        ? '관리자 로그인을 위해 Google 연결을 유지해 주세요.' : '앱 로그인을 위해 카카오 연결을 유지해 주세요.');
    }
    if (proof.provider === removed.providerId || !remaining.some((account) => account.providerId === proof.provider)) {
      throw new AccountError(428, 'REMAINING_METHOD_PROOF_REQUIRED', '남겨 둘 로그인 수단으로 다시 로그인한 후 해제해 주세요.');
    }
    await client.query('DELETE FROM "account" WHERE id=$1 AND "userId"=$2', [accountId, actor.userId]);
    await client.query('UPDATE app_users SET auth_version=auth_version+1,version=version+1,updated_at=now() WHERE user_id=$1', [actor.userId]);
    await client.query('DELETE FROM "session" WHERE "userId"=$1', [actor.userId]);
    return { unlinked: true, reauthenticationRequired: true, providerAuthorizationRevoked: false };
  });
}

export async function cancelOperation(pool: Pool, id: string, token: string, actor: AppMember) {
  return transaction(pool, async (client) => {
    const operation = await readOperation(client, id, true);
    await verifyOperationToken(operation, token);
    if (![operation.owner_user_id, operation.source_user_id].includes(actor.userId)) throw new AccountError(403, 'FORBIDDEN', '이 계정 작업을 취소할 수 없습니다.');
    if (operation.status === 'cancelled') return { id, status: 'cancelled' };
    if (operation.status === 'completed') throw new AccountError(409, 'OPERATION_CLOSED', '이미 완료된 작업입니다.');
    await client.query("UPDATE auth_account_operations SET status='cancelled',data=data-'ownerProof'-'sourceProof'-'approval',updated_at=now() WHERE id=$1", [id]);
    return { id, status: 'cancelled' };
  });
}

export async function previewDeletion(pool: Pool, id: string, token: string, actor: AppMember) {
  return transaction(pool, async (client) => {
    const operation = await readOperation(client, id, true);
    await verifyOperationToken(operation, token); ensurePending(operation);
    if (operation.kind !== 'delete' || operation.owner_user_id !== actor.userId) throw new AccountError(403, 'FORBIDDEN', '본인 계정만 삭제할 수 있습니다.');
    const snapshot = await lockAccountSnapshot(client, [actor.userId]);
    await verifyStoredProof(client, operation.data.ownerProof, snapshot.users);
    const snapshotHash = await hashMergeSnapshot(snapshot);
    await client.query("UPDATE auth_account_operations SET status='ready',data=$2::jsonb,updated_at=now() WHERE id=$1", [id, JSON.stringify({ ...operation.data, snapshotHash })]);
    return { id, status: 'ready', snapshotHash, registrationCount: snapshot.registrations.length,
      anonymizedRegistrationCount: snapshot.registrations.length, loginMethods: snapshot.accounts.map((account) => account.providerId),
      providerAuthorizationRevoked: false };
  });
}

export async function confirmDeletion(pool: Pool, id: string, token: string, actor: AppMember | null, expectedHash: string, requestKey: string) {
  return transaction(pool, async (client) => {
    const operation = await readOperation(client, id, true);
    await verifyOperationToken(operation, token);
    if (operation.status === 'completed') {
      if (operation.data.confirmationKey !== requestKey || operation.data.snapshotHash !== expectedHash) throw new AccountError(409, 'IDEMPOTENCY_CONFLICT', '이미 다른 내용으로 처리된 삭제 요청입니다.');
      return operation.data.result!;
    }
    ensurePending(operation);
    if (!actor || operation.kind !== 'delete' || operation.owner_user_id !== actor.userId) throw new AccountError(403, 'FORBIDDEN', '본인 계정만 삭제할 수 있습니다.');
    // Serialize admin removals so two administrators cannot both remove the last administrator.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('app-admin-account-deletion'))");
    const snapshot = await lockAccountSnapshot(client, [actor.userId]);
    await verifyStoredProof(client, operation.data.ownerProof, snapshot.users);
    if (await hashMergeSnapshot(snapshot) !== expectedHash || operation.data.snapshotHash !== expectedHash) throw new AccountError(409, 'PREVIEW_STALE', '정보가 변경되었습니다. 삭제 내용을 다시 확인해 주세요.');
    if (snapshot.users[0].role === 'admin') {
      const admins = await client.query("SELECT count(*)::integer AS count FROM app_users WHERE role='admin' AND status='active'");
      if (admins.rows[0].count <= 1) throw new AccountError(409, 'LAST_ADMIN', '다른 관리자에게 운영을 넘긴 후 계정을 삭제해 주세요.');
    }
    // Preserve past attendance statistics without the participant's identifying name.
    await client.query(`UPDATE registrations r SET participant_name='탈퇴한 사용자',retreat_answers=NULL,
      status=CASE WHEN e.lifecycle_status='active' AND (e.starts_at IS NULL OR e.starts_at>now()) THEN 'cancelled' ELSE r.status END,
      attendance_status=CASE WHEN e.lifecycle_status='active' AND (e.starts_at IS NULL OR e.starts_at>now()) THEN 'unmarked' ELSE r.attendance_status END,
      cancelled_at=CASE WHEN e.lifecycle_status='active' AND (e.starts_at IS NULL OR e.starts_at>now()) THEN COALESCE(r.cancelled_at,now()) ELSE r.cancelled_at END,
      version=r.version+1,updated_at=now() FROM events e WHERE r.event_id=e.id AND r.user_id=$1`, [actor.userId]);
    await client.query('DELETE FROM "account" WHERE "userId"=$1', [actor.userId]);
    await client.query('DELETE FROM "session" WHERE "userId"=$1', [actor.userId]);
    await client.query('DELETE FROM admin_users WHERE user_id=$1', [actor.userId]);
    await client.query(`UPDATE "user" SET name='탈퇴한 사용자',email=$2,"emailVerified"=false,image=NULL,"updatedAt"=now() WHERE id=$1`,
      [actor.userId, `${crypto.randomUUID()}@deleted.invalid`]);
    await client.query(`UPDATE app_users SET status='deleting',name='',is_member_verified=false,verification_requested_at=NULL,
      peer_group=NULL,gender=NULL,phone_number=NULL,
      auth_version=auth_version+1,version=version+1,updated_at=now() WHERE user_id=$1`, [actor.userId]);
    const result = { id, status: 'completed', reauthenticationRequired: true, providerAuthorizationRevoked: false };
    // Deletion audit deliberately records counts/IDs, not the deleted profile or names.
    const data = { ownerProof: operation.data.ownerProof, snapshotHash: expectedHash, confirmationKey: requestKey, result,
      audit: { deletedUserId: actor.userId, registrationIds: snapshot.registrations.map((registration) => registration.id),
        providers: snapshot.accounts.map((account) => account.providerId) } };
    await client.query("UPDATE auth_account_operations SET status='completed',data=$2::jsonb,completed_at=now(),updated_at=now() WHERE id=$1", [id, JSON.stringify(data)]);
    return result;
  });
}
