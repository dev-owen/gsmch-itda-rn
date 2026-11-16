import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z, ZodError } from 'zod';
import type { PoolClient } from 'pg';
import type { AppEnv } from './types.js';
import { transaction } from './db.js';
import { getUser, requireUser, requireAdmin, type AppMember } from './event-users.js';
import { adminMemberSelect, adminMemberView, findAdminMember, updateAdminMemberProfile, type AdminMemberRow } from './admin-members.js';
import { adminEvent, attendanceInput, cancelRegistration, cancellationInput, correctParticipantName, ensureActiveMember,
  eventInput, EventError, lockMembers, memberEvent, memberView, nameInput, publicEvent, registerForEvent,
  registrationInput, registrationView, setAttendance, versionInput, type EventInput, type EventRow,
  updateEventForAdmin, updateMemberProfile, type MemberRow, type RegistrationRow } from './event-domain.js';

export const eventRoutes = new Hono<AppEnv>();
const noStore = { 'Cache-Control': 'no-store' };
const uuid = z.uuid();
const expected = z.object({ expectedVersion: versionInput }).strict();
const registrationName = z.object({ participantName: nameInput, expectedVersion: versionInput }).strict();
function page(c: Parameters<typeof requireAdmin>[0], defaultLimit = 50) {
  return { limit: z.coerce.number().int().min(1).max(100).parse(c.req.query('limit') || defaultLimit), cursor: c.req.query('cursor') || null };
}

eventRoutes.use('*', async (c, next) => { await next(); c.header('Cache-Control', 'no-store'); });
eventRoutes.onError((error, c) => {
  if (error instanceof HTTPException) return error.getResponse();
  if (error instanceof ZodError) return c.json({ code: 'VALIDATION_ERROR', message: error.issues[0]?.message || '입력 내용을 확인해 주세요.' }, 422, noStore);
  if (error instanceof SyntaxError) return c.json({ code: 'INVALID_JSON', message: '요청 내용을 확인해 주세요.' }, 400, noStore);
  throw error;
});

function canSee(event: EventRow, member: AppMember | null) {
  return event.publication_status === 'published' && (event.visibility === 'public' || member?.isMemberVerified);
}
async function requireLockedAdmin(client: PoolClient, member: AppMember) {
  const row = ensureActiveMember((await lockMembers(client, [member.userId]))[0], member);
  if (row.role !== 'admin') throw new EventError(403, 'FORBIDDEN', '관리자 권한이 필요합니다.');
  return row;
}
function eventParameters(input: EventInput) {
  return [input.title, input.category, input.description, input.memberDetails, input.location, input.target,
    input.startsAt, input.endsAt, input.allDay, input.visibility, input.requiresMemberVerification,
    input.publicationStatus, input.lifecycleStatus, input.registrationEnabled, input.registrationOpensAt,
    input.registrationClosesAt, input.cancellationClosesAt, input.sourcePromotionId];
}
const columns = `title,category,description,member_details,location,target,starts_at,ends_at,all_day,visibility,
  requires_member_verification,publication_status,lifecycle_status,registration_enabled,registration_opens_at,
  registration_closes_at,cancellation_closes_at,source_promotion_id`;

eventRoutes.get('/events', async (c) => {
  const member = await getUser(c);
  const limit = z.coerce.number().int().min(1).max(100).parse(c.req.query('limit') || 20);
  const cursor = c.req.query('cursor') ? uuid.parse(c.req.query('cursor')) : null;
  const category = c.req.query('category') ? z.enum(['event', 'recruitment']).parse(c.req.query('category')) : null;
  const result = await c.get('pool').query<EventRow>(`SELECT * FROM events
    WHERE publication_status = 'published' AND (visibility = 'public' OR $1::boolean)
      AND ($2::text IS NULL OR category = $2)
      AND ($3::uuid IS NULL OR (COALESCE(starts_at,'infinity'::timestamptz),id) >
        (SELECT COALESCE(starts_at,'infinity'::timestamptz),id FROM events WHERE id=$3))
    ORDER BY starts_at NULLS LAST,id LIMIT $4`, [!!member?.isMemberVerified, category, cursor, limit + 1]);
  const items = result.rows.slice(0, limit);
  return c.json({ items: items.map((event) => publicEvent(event)), nextCursor: result.rows.length > limit ? items.at(-1)!.id : null }, 200, noStore);
});

eventRoutes.get('/events/:id', async (c) => {
  const id = uuid.parse(c.req.param('id'));
  const member = await getUser(c);
  const event = (await c.get('pool').query<EventRow>('SELECT * FROM events WHERE id=$1', [id])).rows[0];
  if (!event || !canSee(event, member)) throw new EventError(404, 'NOT_FOUND', '행사를 찾을 수 없습니다.');
  return c.json({ event: member ? memberEvent(event) : publicEvent(event) }, 200, noStore);
});

eventRoutes.get('/me', async (c) => {
  const member = await requireUser(c);
  const row = (await c.get('pool').query<MemberRow>('SELECT * FROM app_users WHERE user_id=$1', [member.userId])).rows[0];
  return c.json({ user: memberView(row) }, 200, noStore);
});
eventRoutes.patch('/me', async (c) => {
  const member = await requireUser(c);
  const row = await updateMemberProfile(c.get('pool'), member, await c.req.json());
  return c.json({ user: memberView(row) }, 200, noStore);
});
eventRoutes.post('/me/member-verification', async (c) => {
  const member = await requireUser(c);
  const row = await transaction(c.get('pool'), async (client) => {
    ensureActiveMember((await lockMembers(client, [member.userId]))[0], member);
    return (await client.query<MemberRow>('UPDATE app_users SET verification_requested_at=now(), version=version+1, updated_at=now() WHERE user_id=$1 RETURNING *', [member.userId])).rows[0];
  });
  return c.json({ user: memberView(row) }, 200, noStore);
});
eventRoutes.get('/me/registrations', async (c) => {
  const member = await requireUser(c);
  const { limit, cursor } = page(c);
  if (cursor) uuid.parse(cursor);
  const result = await c.get('pool').query<RegistrationRow & { event: EventRow }>(`SELECT r.*,to_jsonb(e) AS event
    FROM registrations r JOIN events e ON e.id=r.event_id WHERE r.user_id=$1
      AND ($2::uuid IS NULL OR (r.created_at,r.id) < (SELECT created_at,id FROM registrations WHERE id=$2 AND user_id=$1))
    ORDER BY r.created_at DESC,r.id DESC LIMIT $3`, [member.userId, cursor, limit + 1]);
  const rows = result.rows.slice(0, limit);
  return c.json({ items: rows.map((row) => registrationView(row, row.event)), nextCursor: result.rows.length > limit ? rows.at(-1)!.id : null }, 200, noStore);
});
eventRoutes.get('/me/registrations/:id', async (c) => {
  const member = await requireUser(c);
  const result = await c.get('pool').query<RegistrationRow & { event: EventRow }>(`SELECT r.*,to_jsonb(e) AS event
    FROM registrations r JOIN events e ON e.id=r.event_id WHERE r.id=$1 AND r.user_id=$2`, [uuid.parse(c.req.param('id')), member.userId]);
  if (!result.rows[0]) throw new EventError(404, 'NOT_FOUND', '신청을 찾을 수 없습니다.');
  return c.json({ registration: registrationView(result.rows[0], result.rows[0].event) }, 200, noStore);
});
eventRoutes.post('/events/:id/registrations', async (c) => {
  const member = await requireUser(c);
  const result = await registerForEvent(c.get('pool'), member, uuid.parse(c.req.param('id')), registrationInput.parse(await c.req.json()));
  return c.json({ registration: registrationView(result.registration, result.event) }, 200, noStore);
});
eventRoutes.delete('/me/registrations/:id', async (c) => {
  const member = await requireUser(c);
  const input = cancellationInput.parse(await c.req.json());
  const result = await cancelRegistration(c.get('pool'), member, uuid.parse(c.req.param('id')), input.expectedVersion);
  return c.json({ registration: registrationView(result.registration, result.event) }, 200, noStore);
});
eventRoutes.patch('/me/registrations/:id', async (c) => {
  const member = await requireUser(c);
  const input = registrationName.parse(await c.req.json());
  const result = await correctParticipantName(c.get('pool'), member, uuid.parse(c.req.param('id')), input.participantName, input.expectedVersion);
  return c.json({ registration: registrationView(result.registration, result.event) }, 200, noStore);
});

eventRoutes.get('/admin/users', async (c) => {
  await requireAdmin(c);
  const { limit, cursor } = page(c);
  if (cursor) z.string().min(1).max(200).parse(cursor);
  const search = z.string().trim().max(100).parse(c.req.query('search') || '');
  const verification = c.req.query('verification') ? z.enum(['verified', 'pending', 'unverified']).parse(c.req.query('verification')) : null;
  const phoneSearch = search.replace(/[\s().-]/g, '');
  const result = await c.get('pool').query<AdminMemberRow>(`${adminMemberSelect}
    WHERE m.status='active' AND ($1='' OR m.name ILIKE '%' || $1 || '%' OR u.email ILIKE '%' || $1 || '%'
      OR ($4<>'' AND m.phone_number ILIKE '%' || $4 || '%'))
      AND ($2::text IS NULL OR (m.name,m.user_id) > (SELECT name,user_id FROM app_users WHERE user_id=$2))
      AND ($5::text IS NULL OR ($5='verified' AND m.is_member_verified)
        OR ($5='pending' AND NOT m.is_member_verified AND m.verification_requested_at IS NOT NULL)
        OR ($5='unverified' AND NOT m.is_member_verified AND m.verification_requested_at IS NULL))
    ORDER BY m.name,m.user_id LIMIT $3`, [search, cursor, limit + 1, phoneSearch, verification]);
  const rows = result.rows.slice(0, limit);
  return c.json({ items: rows.map(adminMemberView), nextCursor: result.rows.length > limit ? rows.at(-1)!.user_id : null }, 200, noStore);
});
eventRoutes.get('/admin/users/:id', async (c) => {
  await requireAdmin(c);
  const id = z.string().min(1).max(200).parse(c.req.param('id'));
  return c.json({ user: adminMemberView(await findAdminMember(c.get('pool'), id)) }, 200, noStore);
});
eventRoutes.get('/admin/users/:id/registrations', async (c) => {
  await requireAdmin(c);
  const id = z.string().min(1).max(200).parse(c.req.param('id'));
  await findAdminMember(c.get('pool'), id);
  const { limit, cursor } = page(c);
  if (cursor) uuid.parse(cursor);
  const result = await c.get('pool').query<RegistrationRow & { event: EventRow }>(`SELECT r.*,to_jsonb(e) AS event
    FROM registrations r JOIN events e ON e.id=r.event_id WHERE r.user_id=$1
      AND ($2::uuid IS NULL OR (r.created_at,r.id) < (SELECT created_at,id FROM registrations WHERE id=$2 AND user_id=$1))
    ORDER BY r.created_at DESC,r.id DESC LIMIT $3`, [id, cursor, limit + 1]);
  const rows = result.rows.slice(0, limit);
  return c.json({ items: rows.map(row => ({ ...registrationView(row, row.event), userId: row.user_id, checkedBy: row.checked_by })),
    nextCursor: result.rows.length > limit ? rows.at(-1)!.id : null }, 200, noStore);
});
eventRoutes.patch('/admin/users/:id/profile', async (c) => {
  const member = await requireAdmin(c);
  const id = z.string().min(1).max(200).parse(c.req.param('id'));
  const row = await updateAdminMemberProfile(c.get('pool'), member, id, await c.req.json());
  return c.json({ user: adminMemberView(row) }, 200, noStore);
});
async function verifyMember(c: Parameters<typeof requireAdmin>[0]) {
  const member = await requireAdmin(c);
  const input = z.object({ isMemberVerified: z.boolean(), expectedVersion: versionInput }).strict().parse(await c.req.json());
  const id = c.req.param('id')!;
  const row = await transaction(c.get('pool'), async (client) => {
    const users = await lockMembers(client, [member.userId, id]);
    const admin = ensureActiveMember(users.find((row) => row.user_id === member.userId), member);
    if (admin.role !== 'admin') throw new EventError(403, 'FORBIDDEN', '관리자 권한이 필요합니다.');
    const target = ensureActiveMember(users.find((row) => row.user_id === id));
    if (target.version !== input.expectedVersion) throw new EventError(409, 'USER_CHANGED', '변경된 사용자 정보를 확인해 주세요.');
    return (await client.query<MemberRow>(`UPDATE app_users SET is_member_verified=$2,
      member_verification_revoked_at=CASE WHEN $2 THEN NULL ELSE now() END,
      verification_requested_at=NULL,version=version+1,updated_at=now() WHERE user_id=$1 RETURNING *`, [id, input.isMemberVerified])).rows[0];
  });
  return c.json({ user: memberView(row) }, 200, noStore);
}
eventRoutes.patch('/admin/users/:id', verifyMember);
eventRoutes.post('/admin/users/:id/member-verification', verifyMember);

eventRoutes.get('/admin/events', async (c) => {
  await requireAdmin(c);
  const { limit, cursor } = page(c);
  if (cursor) uuid.parse(cursor);
  const result = await c.get('pool').query<EventRow>(`SELECT * FROM events
    WHERE $1::uuid IS NULL OR (created_at,id) < (SELECT created_at,id FROM events WHERE id=$1)
    ORDER BY created_at DESC,id DESC LIMIT $2`, [cursor, limit + 1]);
  const rows = result.rows.slice(0, limit);
  return c.json({ items: rows.map(adminEvent), nextCursor: result.rows.length > limit ? rows.at(-1)!.id : null }, 200, noStore);
});
eventRoutes.get('/admin/event-sources', async (c) => {
  await requireAdmin(c);
  const { limit, cursor } = page(c);
  if (cursor) uuid.parse(cursor);
  const search = z.string().max(100).parse(c.req.query('search') || '');
  const result = await c.get('pool').query<{ id: string; bulletin_id: string; title: string; body: string; details: unknown; url: string | null }>(
    `SELECT p.id,p.bulletin_id,p.title,p.body,p.details,p.url FROM promotions p JOIN bulletins b ON b.id=p.bulletin_id
      WHERE b.status='published' AND ($1='' OR p.title ILIKE '%' || $1 || '%')
        AND ($2::uuid IS NULL OR (b.service_date,p.id) < (SELECT b2.service_date,p2.id FROM promotions p2 JOIN bulletins b2 ON b2.id=p2.bulletin_id WHERE p2.id=$2))
      ORDER BY b.service_date DESC,p.id DESC LIMIT $3`, [search, cursor, limit + 1]);
  const rows = result.rows.slice(0, limit);
  return c.json({ items: rows.map((row) => ({ id: row.id, bulletinId: row.bulletin_id, title: row.title, body: row.body, details: row.details, url: row.url || '' })),
    nextCursor: result.rows.length > limit ? rows.at(-1)!.id : null }, 200, noStore);
});
eventRoutes.get('/admin/events/:id', async (c) => {
  await requireAdmin(c);
  const event = (await c.get('pool').query<EventRow>('SELECT * FROM events WHERE id=$1', [uuid.parse(c.req.param('id'))])).rows[0];
  if (!event) throw new EventError(404, 'NOT_FOUND', '행사를 찾을 수 없습니다.');
  return c.json({ event: adminEvent(event) }, 200, noStore);
});
eventRoutes.post('/admin/events', async (c) => {
  const member = await requireAdmin(c);
  const input = eventInput.parse(await c.req.json());
  const event = await transaction(c.get('pool'), async (client) => {
    await requireLockedAdmin(client, member);
    return (await client.query<EventRow>(`INSERT INTO events (${columns},cancelled_at,completed_at)
      VALUES (${Array.from({ length: 18 }, (_, i) => `$${i + 1}`).join(',')},
        CASE WHEN $13='cancelled' THEN now() ELSE NULL END,CASE WHEN $13='completed' THEN now() ELSE NULL END) RETURNING *`, eventParameters(input))).rows[0];
  });
  return c.json({ event: adminEvent(event) }, 201, noStore);
});
async function updateEvent(c: Parameters<typeof requireAdmin>[0]) {
  const member = await requireAdmin(c);
  const id = uuid.parse(c.req.param('id'));
  const event = await updateEventForAdmin(c.get('pool'), member, id, await c.req.json());
  return c.json({ event: adminEvent(event) }, 200, noStore);
}
eventRoutes.patch('/admin/events/:id', updateEvent);
eventRoutes.put('/admin/events/:id', updateEvent);
async function changeEventState(c: Parameters<typeof requireAdmin>[0], action: 'hidden' | 'cancelled' | 'completed') {
  const member = await requireAdmin(c);
  const id = uuid.parse(c.req.param('id'));
  const input = expected.parse(await c.req.json());
  const event = await transaction(c.get('pool'), async (client) => {
    await requireLockedAdmin(client, member);
    const row = (await client.query<EventRow>('SELECT * FROM events WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!row) throw new EventError(404, 'NOT_FOUND', '행사를 찾을 수 없습니다.');
    if (row.version !== input.expectedVersion) throw new EventError(409, 'EVENT_CHANGED', '변경된 행사를 다시 확인해 주세요.');
    if (action === 'hidden') return (await client.query<EventRow>("UPDATE events SET publication_status='hidden',version=version+1,updated_at=now() WHERE id=$1 RETURNING *", [id])).rows[0];
    if (row.lifecycle_status !== 'active' && row.lifecycle_status !== action) throw new EventError(409, 'EVENT_CLOSED', '이미 취소·종료된 행사입니다.');
    return (await client.query<EventRow>(`UPDATE events SET lifecycle_status=$2,registration_enabled=false,
      cancelled_at=CASE WHEN $2='cancelled' THEN COALESCE(cancelled_at,now()) ELSE cancelled_at END,
      completed_at=CASE WHEN $2='completed' THEN COALESCE(completed_at,now()) ELSE completed_at END,
      version=version+1,updated_at=now() WHERE id=$1 RETURNING *`, [id, action])).rows[0];
  });
  return c.json({ event: adminEvent(event) }, 200, noStore);
}
eventRoutes.delete('/admin/events/:id', (c) => changeEventState(c, 'hidden'));
eventRoutes.post('/admin/events/:id/cancel', (c) => changeEventState(c, 'cancelled'));
eventRoutes.post('/admin/events/:id/complete', (c) => changeEventState(c, 'completed'));

eventRoutes.get('/admin/events/:id/registrations', async (c) => {
  await requireAdmin(c);
  const { limit, cursor } = page(c);
  if (cursor) uuid.parse(cursor);
  const search = z.string().max(100).parse(c.req.query('search') || '');
  const result = await c.get('pool').query<RegistrationRow>(`SELECT * FROM registrations WHERE event_id=$1
    AND ($2='' OR participant_name ILIKE '%' || $2 || '%' OR confirmation_code ILIKE '%' || $2 || '%')
    AND ($3::uuid IS NULL OR (participant_name,id) > (SELECT participant_name,id FROM registrations WHERE id=$3 AND event_id=$1))
    ORDER BY participant_name,id LIMIT $4`, [uuid.parse(c.req.param('id')), search, cursor, limit + 1]);
  const rows = result.rows.slice(0, limit);
  return c.json({ items: rows.map((row) => ({ ...registrationView(row), userId: row.user_id, checkedBy: row.checked_by })),
    nextCursor: result.rows.length > limit ? rows.at(-1)!.id : null }, 200, noStore);
});
eventRoutes.patch('/admin/events/:id/registrations/:registrationId/attendance', async (c) => {
  const member = await requireAdmin(c);
  const registrationId = uuid.parse(c.req.param('registrationId'));
  const association = await c.get('pool').query('SELECT 1 FROM registrations WHERE id=$1 AND event_id=$2', [registrationId, uuid.parse(c.req.param('id'))]);
  if (!association.rowCount) throw new EventError(404, 'NOT_FOUND', '신청을 찾을 수 없습니다.');
  const result = await setAttendance(c.get('pool'), member, registrationId, attendanceInput.parse(await c.req.json()));
  return c.json({ registration: registrationView(result.registration, result.event) }, 200, noStore);
});
eventRoutes.delete('/admin/events/:id/registrations/:registrationId', async (c) => {
  const member = await requireAdmin(c);
  const registrationId = uuid.parse(c.req.param('registrationId'));
  const association = await c.get('pool').query('SELECT 1 FROM registrations WHERE id=$1 AND event_id=$2', [registrationId, uuid.parse(c.req.param('id'))]);
  if (!association.rowCount) throw new EventError(404, 'NOT_FOUND', '신청을 찾을 수 없습니다.');
  const input = cancellationInput.parse(await c.req.json());
  const result = await cancelRegistration(c.get('pool'), member, registrationId, input.expectedVersion);
  return c.json({ registration: registrationView(result.registration, result.event) }, 200, noStore);
});
