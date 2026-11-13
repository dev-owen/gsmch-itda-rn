import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z, ZodError } from 'zod';
import type { AppEnv } from './types.js';
import { requireAdmin } from './event-users.js';
import { adminEvent, versionInput } from './event-domain.js';
import { changeSourceSyncMode } from './event-sync-store.js';

export const syncRoutes = new Hono<AppEnv>();
syncRoutes.onError((error, c) => {
  if (error instanceof HTTPException) return error.getResponse();
  if (error instanceof ZodError) return c.json({ code: 'VALIDATION_ERROR', message: error.issues[0]?.message || '입력을 확인해 주세요.' }, 422);
  if (error instanceof SyntaxError) return c.json({ code: 'INVALID_JSON', message: '요청 내용을 확인해 주세요.' }, 400);
  throw error;
});
syncRoutes.patch('/admin/events/:id/source-sync', async (c) => {
  const actor = await requireAdmin(c);
  const input = z.object({ mode: z.enum(['manual', 'automatic']), expectedVersion: versionInput }).strict().parse(await c.req.json());
  const row = await changeSourceSyncMode(c.get('pool'), actor, z.uuid().parse(c.req.param('id')), input.mode, input.expectedVersion);
  return c.json({ event: adminEvent(row) }, 200, { 'Cache-Control': 'no-store' });
});
