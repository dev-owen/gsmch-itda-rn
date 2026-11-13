import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z, ZodError } from 'zod';
import { authOrigins, createAuth } from './auth.js';
import { isAccountCallbackAllowed, isAccountOriginAllowed } from './account-security.js';
import { getMember, requireAdmin, type AppMember } from './event-users.js';
import { AccountError, approveMerge, cancelOperation, confirmDeletion, confirmMerge,
  prepareOperation, previewDeletion, previewMerge, proveMerge, readOperation, readRecentProof,
  unlinkLogin, verifyOperationToken } from './account-store.js';
import type { AppEnv } from './types';

export const accountRoutes = new Hono<AppEnv>();
const noStore = { 'Cache-Control': 'no-store' };
const providerSchema = z.enum(['google', 'kakao', 'apple']);
const prepareSchema = z.object({ provider: providerSchema.optional() }).strict();
const confirmSchema = z.object({ snapshotHash: z.string().regex(/^[a-f0-9]{64}$/), confirmed: z.literal(true) }).strict();
const approveSchema = z.object({ snapshotHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const linkSchema = z.object({ provider: providerSchema, callbackURL: z.string().max(500).optional() }).strict();
const uuidSchema = z.string().uuid();

function operationId(c: Context<AppEnv>): string { return uuidSchema.parse(c.req.param('id')); }
function token(c: Context<AppEnv>): string {
  const value = c.req.header('X-Account-Operation-Token') ?? '';
  if (!/^[a-f0-9]{64}$/.test(value)) throw new AccountError(403, 'INVALID_OPERATION_PROOF', '계정 작업 확인 정보가 필요합니다.');
  return value;
}
function requestKey(c: Context<AppEnv>): string {
  const value = c.req.header('Idempotency-Key') ?? '';
  if (!/^[A-Za-z0-9_.:-]{8,128}$/.test(value)) throw new AccountError(422, 'IDEMPOTENCY_KEY_REQUIRED', '요청 식별자를 다시 생성해 주세요.');
  return value;
}
async function member(c: Context<AppEnv>): Promise<AppMember> { return (await getMember(c, { required: true, fresh: true }))!; }
type AccountHandler = (c: Context<AppEnv>) => Promise<Response>;
function guarded(handler: AccountHandler): AccountHandler {
  return async (c) => {
    try {
      if (!['GET', 'HEAD'].includes(c.req.method)) {
        if (!c.req.header('Content-Type')?.toLowerCase().startsWith('application/json')) throw new AccountError(422, 'JSON_REQUIRED', '올바른 형식으로 다시 요청해 주세요.');
        const origin = c.req.header('Origin');
        if (!isAccountOriginAllowed(origin, authOrigins(c.env), c.env.BETTER_AUTH_URL)) {
          throw new AccountError(403, 'UNTRUSTED_ORIGIN', '허용되지 않은 요청입니다.');
        }
      }
      const response = await handler(c);
      response.headers.set('Cache-Control', 'no-store');
      return response;
    } catch (error) {
      if (error instanceof AccountError) return c.json({ code: error.code, message: error.message }, error.status, noStore);
      if (error instanceof ZodError || error instanceof SyntaxError) return c.json({ code: 'INVALID_INPUT', message: '입력 내용을 다시 확인해 주세요.' }, 422, noStore);
      if (error instanceof HTTPException) return error.getResponse();
      console.error('account_operation_failed', { error: error instanceof Error ? error.name : 'unknown' });
      return c.json({ code: 'ACCOUNT_OPERATION_FAILED', message: '계정 작업을 완료하지 못했습니다. 변경 내용은 저장되지 않았습니다.' }, 500, noStore);
    }
  };
}

accountRoutes.get('/me/login-methods', guarded(async (c) => {
  const actor = await member(c);
  const accounts = await c.get('pool').query<{ id: string; providerId: string; createdAt: Date }>(
    'SELECT id,"providerId","createdAt" FROM "account" WHERE "userId"=$1 ORDER BY "createdAt",id', [actor.userId]);
  return c.json({ userId: actor.userId, methods: accounts.rows.map((account) => ({ id: account.id, provider: account.providerId,
    connectedAt: new Date(account.createdAt).toISOString() })), canUnlink: accounts.rows.length > 1 }, 200, noStore);
}));

// Keep the auth library's state/cookie protocol. Only this guarded entry point is exposed.
// The root router must deny direct /api/auth/link-social and /unlink-account calls.
accountRoutes.post('/me/login-methods/link', guarded(async (c) => {
  const actor = await member(c);
  await readRecentProof(c.get('pool'), actor);
  const input = linkSchema.parse(await c.req.json());
  const callbackURL = input.callbackURL ?? '/account/login-methods';
  if (!isAccountCallbackAllowed(callbackURL, authOrigins(c.env))) {
    throw new AccountError(422, 'INVALID_CALLBACK_URL', '앱의 계정 설정 화면으로만 돌아갈 수 있습니다.');
  }
  const url = new URL(c.req.url); url.pathname = '/api/auth/link-social'; url.search = '';
  const headers = new Headers(c.req.raw.headers); headers.set('Content-Type', 'application/json');
  return createAuth(c.env, c.get('pool')).handler(new Request(url, { method: 'POST', headers,
    body: JSON.stringify({ provider: input.provider, callbackURL }) }));
}));

accountRoutes.post('/me/login-methods/:accountId/unlink', guarded(async (c) => {
  const accountId = z.string().min(1).max(200).parse(c.req.param('accountId'));
  return c.json(await unlinkLogin(c.get('pool'), await member(c), accountId), 200, noStore);
}));

accountRoutes.post('/account-merges/prepare', guarded(async (c) => {
  const input = prepareSchema.parse(await c.req.json());
  const { operation, token: operationToken } = await prepareOperation(c.get('pool'), await member(c), 'merge', requestKey(c), c.env.BETTER_AUTH_SECRET, input.provider);
  return c.json({ id: operation.id, operationId: operation.id, operationToken, status: operation.status, expiresAt: operation.expires_at }, 201, noStore);
}));

accountRoutes.post('/account-merges/:id/prove', guarded(async (c) =>
  c.json(await proveMerge(c.get('pool'), operationId(c), token(c), await member(c)), 200, noStore)));

const mergePreview = guarded(async (c) => c.json(await previewMerge(c.get('pool'), operationId(c), token(c), await member(c)), 200, noStore));
accountRoutes.get('/account-merges/:id/preview', mergePreview);
accountRoutes.post('/account-merges/:id/preview', mergePreview);

accountRoutes.post('/account-merges/:id/confirm', guarded(async (c) => {
  const input = confirmSchema.parse(await c.req.json());
  // Completed retries are authenticated by the unguessable operation token after session revocation.
  const operation = await readOperation(c.get('pool'), operationId(c));
  const actor = operation.status === 'completed' ? null : await member(c);
  return c.json(await confirmMerge(c.get('pool'), operation.id, token(c), actor, input.snapshotHash, requestKey(c)), 200, noStore);
}));

const operationStatus = guarded(async (c) => {
  const operation = await readOperation(c.get('pool'), operationId(c));
  await verifyOperationToken(operation, token(c));
  const expired = !['completed', 'cancelled'].includes(operation.status) && new Date(operation.expires_at).getTime() <= Date.now();
  return c.json({ id: operation.id, status: expired ? 'expired' : operation.status, expiresAt: operation.expires_at,
    result: operation.status === 'completed' ? operation.data.result : undefined }, 200, noStore);
});
accountRoutes.get('/account-merges/:id/status', operationStatus);
accountRoutes.post('/account-merges/:id/cancel', guarded(async (c) =>
  c.json(await cancelOperation(c.get('pool'), operationId(c), token(c), await member(c)), 200, noStore)));

accountRoutes.post('/admin/account-merges/:id/approve', guarded(async (c) => {
  const input = approveSchema.parse(await c.req.json());
  return c.json(await approveMerge(c.get('pool'), operationId(c), input.snapshotHash, await requireAdmin(c)), 200, noStore);
}));

accountRoutes.post('/me/delete/prepare', guarded(async (c) => {
  const { operation, token: operationToken } = await prepareOperation(c.get('pool'), await member(c), 'delete', requestKey(c), c.env.BETTER_AUTH_SECRET);
  return c.json({ id: operation.id, operationId: operation.id, operationToken, status: operation.status, expiresAt: operation.expires_at }, 201, noStore);
}));
const deletionPreview = guarded(async (c) => c.json(await previewDeletion(c.get('pool'), operationId(c), token(c), await member(c)), 200, noStore));
accountRoutes.get('/me/delete/:id/preview', deletionPreview);
accountRoutes.post('/me/delete/:id/preview', deletionPreview);
accountRoutes.post('/me/delete/:id/confirm', guarded(async (c) => {
  const input = confirmSchema.parse(await c.req.json());
  const operation = await readOperation(c.get('pool'), operationId(c));
  const actor = operation.status === 'completed' ? null : await member(c);
  return c.json(await confirmDeletion(c.get('pool'), operation.id, token(c), actor, input.snapshotHash, requestKey(c)), 200, noStore);
}));
accountRoutes.get('/me/delete/:id/status', operationStatus);
accountRoutes.post('/me/delete/:id/cancel', guarded(async (c) =>
  c.json(await cancelOperation(c.get('pool'), operationId(c), token(c), await member(c)), 200, noStore)));

/** For the root auth catch-all: mutations must go through the guarded routes above. */
export function protectedAuthMutation(path: string): boolean {
  return ['/api/auth/link-social', '/api/auth/unlink-account', '/api/auth/delete-user'].includes(path.replace(/\/$/, ''));
}
