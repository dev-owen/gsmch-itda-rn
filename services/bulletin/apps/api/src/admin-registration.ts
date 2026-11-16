import type { Pool } from 'pg';
import type { MemberRow } from './event-domain.js';
import type { Bindings } from './types.js';

/** Temporary policy: any verified Google login is an administrator. */
export function automaticAdminRegistration(env: Pick<Bindings, 'ADMIN_REGISTRATION_MODE'>): boolean {
  return (env.ADMIN_REGISTRATION_MODE || 'automatic') === 'automatic';
}

/** Call only after server-side OAuth/session verification; never accept the provider from API input. */
export async function registerGoogleAdmin(pool: Pool, userId: string, authVersion: number): Promise<MemberRow | null> {
  const result = await pool.query<MemberRow>(`WITH member AS (
    INSERT INTO app_users (user_id, name, role, auth_version)
    SELECT id, left(btrim(COALESCE(name, '')), 50), 'admin', $2 FROM "user" WHERE id=$1
    ON CONFLICT (user_id) DO UPDATE SET role='admin',
      version=app_users.version + CASE WHEN app_users.role <> 'admin' THEN 1 ELSE 0 END,
      updated_at=CASE WHEN app_users.role <> 'admin' THEN now() ELSE app_users.updated_at END
    WHERE app_users.status='active' AND app_users.auth_version=$2
    RETURNING *
  ), grant_admin AS (
    INSERT INTO admin_users (user_id) SELECT user_id FROM member WHERE true
    ON CONFLICT (user_id) DO NOTHING RETURNING user_id
  ) SELECT * FROM member`, [userId, authVersion]);
  return result.rows[0] || null;
}
