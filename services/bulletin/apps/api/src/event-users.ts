import type { Context } from 'hono';
import { createAuth } from './auth.js';
import type { AppEnv } from './types.js';
import { ensureActiveMember, EventError, iso, type MemberRow } from './event-domain.js';

export type AppMember = {
  userId: string; name: string; role: 'admin' | 'user'; isMemberVerified: boolean;
  memberVerificationRevokedAt: string | null; status: 'active' | 'merged' | 'deleting';
  mergedIntoUserId: string | null; version: number; authVersion: number;
  sessionId: string; sessionCreatedAt: string;
};

/** fresh bypasses the auth cookie cache; recent OAuth proof is a separate requirement. */
export async function getMember(c: Context<AppEnv>, options: { required?: boolean; fresh?: boolean } = {}): Promise<AppMember | null> {
  // Anonymous event requests do not need an auth adapter or its database tables.
  const headers = c.req.raw.headers;
  if (!headers.get('Cookie')?.trim() && !headers.get('Authorization')?.trim()) {
    if (options.required) throw new EventError(401, 'UNAUTHENTICATED', '로그인이 필요합니다.');
    return null;
  }
  const pool = c.get('pool');
  const result = await createAuth(c.env, pool).api.getSession({ headers: c.req.raw.headers, query: { disableCookieCache: true } });
  if (!result) {
    if (options.required) throw new EventError(401, 'UNAUTHENTICATED', '로그인이 필요합니다.');
    return null;
  }
  // Auth owns identity mapping. App membership is initialized once, never from provider metadata roles.
  await pool.query(`INSERT INTO app_users (user_id, name, role)
    VALUES ($1,$2,CASE WHEN EXISTS (SELECT 1 FROM admin_users WHERE user_id=$1) THEN 'admin' ELSE 'user' END)
    ON CONFLICT (user_id) DO NOTHING`, [result.user.id, (result.user.name || '').trim().slice(0, 50)]);
  const row = (await pool.query<MemberRow>('SELECT * FROM app_users WHERE user_id=$1', [result.user.id])).rows[0];
  const session = result.session as typeof result.session & { authVersion?: number };
  const authVersion = typeof session.authVersion === 'number' ? session.authVersion : 1;
  if (!row || row.status !== 'active' || row.auth_version !== authVersion) {
    if (!options.required) return null;
    ensureActiveMember(row, { userId: result.user.id, authVersion });
  }
  return { userId: row.user_id, name: row.name, role: row.role, isMemberVerified: row.is_member_verified,
    memberVerificationRevokedAt: iso(row.member_verification_revoked_at), status: row.status,
    mergedIntoUserId: row.merged_into_user_id, version: row.version, authVersion,
    sessionId: session.id, sessionCreatedAt: iso(session.createdAt)! };
}

export async function requireAdmin(c: Context<AppEnv>): Promise<AppMember> {
  const member = (await getMember(c, { required: true, fresh: true }))!;
  if (member.role !== 'admin') throw new EventError(403, 'FORBIDDEN', '관리자 권한이 필요합니다.');
  return member;
}
