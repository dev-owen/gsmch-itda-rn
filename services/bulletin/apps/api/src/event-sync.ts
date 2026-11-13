import { Pool } from 'pg';
import { Hono } from 'hono';
import { z } from 'zod';
import { requireAdmin } from './event-users.js';
import { fetchBulletinSource } from './bulletin-source.js';
import { applyBulletinSnapshot, getSyncStatus, recordSyncFailure } from './event-sync-store.js';
import { BULLETIN_SOURCE_ORIGIN, type SyncResult, type SyncTrigger } from './event-sync-types.js';
import type { AppEnv, Bindings } from './types.js';

export function sourceOrigin(env: Pick<Bindings, 'BULLETIN_SOURCE_ORIGIN' | 'BETTER_AUTH_URL'>): string {
  const url = new URL(env.BULLETIN_SOURCE_ORIGIN || BULLETIN_SOURCE_ORIGIN);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('INVALID_SOURCE_ORIGIN');
  }
  if (url.origin === new URL(env.BETTER_AUTH_URL).origin) throw new Error('SOURCE_LOOP');
  return url.origin;
}

export async function runBulletinSync(pool: Pool, env: Pick<Bindings, 'BULLETIN_SOURCE_ORIGIN' | 'BETTER_AUTH_URL'>,
  trigger: SyncTrigger, fetcher: typeof fetch = fetch): Promise<SyncResult> {
  const requestedAt = new Date().toISOString();
  try {
    const snapshot = await fetchBulletinSource(sourceOrigin(env), fetcher);
    return await applyBulletinSnapshot(pool, { ...snapshot, requestedAt }, trigger);
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
      ? error.code : error instanceof Error && ['INVALID_SOURCE_ORIGIN', 'SOURCE_LOOP'].includes(error.message)
        ? error.message : 'SYNC_FAILED';
    return recordSyncFailure(pool, trigger, code);
  }
}

export async function scheduledBulletinSync(env: Bindings): Promise<void> {
  const connectionString = env.HYPERDRIVE?.connectionString || env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_NOT_CONFIGURED');
  const pool = new Pool({ connectionString, max: 3, idleTimeoutMillis: 1000 });
  try {
    const result = await runBulletinSync(pool, env, 'scheduled');
    if (result.status === 'failed') throw new Error(result.errorCode || 'SYNC_FAILED');
  } finally { await pool.end(); }
}

export const syncAdminRoutes = new Hono<AppEnv>();
syncAdminRoutes.use('/admin/event-sync', async (c, next) => { await requireAdmin(c); await next(); c.header('Cache-Control', 'no-store'); });
syncAdminRoutes.get('/admin/event-sync', async (c) => c.json({
  schedule: '매주 월요일 오전 9시 (한국 시간)', ...(await getSyncStatus(c.get('pool'))),
}, 200, { 'Cache-Control': 'no-store' }));
syncAdminRoutes.post('/admin/event-sync', async (c) => {
  z.object({}).strict().parse(await c.req.json());
  return c.json(await runBulletinSync(c.get('pool'), c.env, 'manual'), 200, { 'Cache-Control': 'no-store' });
});
