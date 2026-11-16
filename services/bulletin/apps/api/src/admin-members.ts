import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { transaction } from './db.js';
import { ensureActiveMember, EventError, iso, lockMembers, memberView, versionInput, type Actor, type MemberRow } from './event-domain.js';
import { profilePatchInput } from './retreat-validation.js';

export type AdminMemberRow = MemberRow & {
  email: string | null; providers: string[]; created_at: Date | string; updated_at: Date | string;
};

// Select login metadata explicitly. OAuth credentials and session data never enter the response.
export const adminMemberSelect = `SELECT m.*,u.email,
  ARRAY(SELECT DISTINCT a."providerId" FROM "account" a WHERE a."userId"=m.user_id ORDER BY a."providerId") AS providers
  FROM app_users m LEFT JOIN "user" u ON u.id=m.user_id`;

export function adminMemberView(row: AdminMemberRow) {
  return { ...memberView(row), email: row.email || null, providers: row.providers || [],
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) };
}

export async function findAdminMember(db: Pool | PoolClient, id: string) {
  const row = (await db.query<AdminMemberRow>(`${adminMemberSelect} WHERE m.user_id=$1 AND m.status='active'`, [id])).rows[0];
  if (!row) throw new EventError(404, 'NOT_FOUND', '사용자를 찾을 수 없습니다.');
  return row;
}

const adminProfileInput = z.object({
  expectedVersion: versionInput,
  // Keep identity and role changes outside profile administration.
  name: profilePatchInput.shape.name,
  peerGroup: profilePatchInput.shape.peerGroup,
  gender: profilePatchInput.shape.gender,
  phoneNumber: profilePatchInput.shape.phoneNumber,
}).strict().refine(value => Object.keys(value).some(key => key !== 'expectedVersion'), '변경할 정보를 입력해 주세요.');

export async function updateAdminMemberProfile(pool: Pool, actor: Actor, id: string, body: unknown): Promise<AdminMemberRow> {
  const { expectedVersion, ...input } = adminProfileInput.parse(body);
  return transaction(pool, async (client) => {
    const users = await lockMembers(client, [actor.userId, id]);
    const admin = ensureActiveMember(users.find(row => row.user_id === actor.userId), actor);
    if (admin.role !== 'admin') throw new EventError(403, 'FORBIDDEN', '관리자 권한이 필요합니다.');
    const target = users.find(row => row.user_id === id);
    if (!target || target.status !== 'active') throw new EventError(404, 'NOT_FOUND', '사용자를 찾을 수 없습니다.');
    if (target.version !== expectedVersion) throw new EventError(409, 'USER_CHANGED', '변경된 사용자 정보를 확인해 주세요.');
    const fields = { name: 'name', peerGroup: 'peer_group', gender: 'gender', phoneNumber: 'phone_number' } as const;
    const keys = Object.keys(input) as Array<keyof typeof fields>;
    await client.query(`UPDATE app_users SET ${keys.map((key, index) => `${fields[key]}=$${index + 2}`).join(',')},
      version=version+1,updated_at=now() WHERE user_id=$1`, [id, ...keys.map(key => input[key])]);
    // Registration answers are the submitted snapshot and are intentionally preserved.
    return findAdminMember(client, id);
  });
}
