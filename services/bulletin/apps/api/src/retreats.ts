import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Pool } from 'pg';
import { ZodError } from 'zod';
import type { AppEnv } from './types.js';
import { transaction } from './db.js';
import { getMember } from './event-users.js';
import { assertCanRegister, ensureActiveMember, EventError, lockMembers, publicEvent, registrationView,
  retreatAnswersView, type Actor, type EventRow, type MemberRow, type RegistrationRow } from './event-domain.js';
import { DEMO_EVENT_ID, nehemiahWinterRetreat, RETREAT_SLUG } from './retreat-content.js';
import { phoneNumberInput, retreatRegistrationInput } from './retreat-validation.js';
import type { RetreatAnswers, RetreatRegistrationInput } from './retreat-types.js';

const noStore = { 'Cache-Control': 'no-store' };
export const retreatRoutes = new Hono<AppEnv>();
retreatRoutes.use('*', async (c, next) => { await next(); c.header('Cache-Control', 'no-store'); });
retreatRoutes.onError((error, c) => {
  if (error instanceof HTTPException) return error.getResponse();
  if (error instanceof ZodError) return c.json({ code: 'VALIDATION_ERROR', message: error.issues[0]?.message || '신청 내용을 확인해 주세요.' }, 422, noStore);
  if (error instanceof SyntaxError) return c.json({ code: 'INVALID_JSON', message: '요청 내용을 확인해 주세요.' }, 400, noStore);
  throw error;
});

function normalized(value: string | null | undefined) { return (value || '').trim().normalize('NFC'); }
/** Profile corrections belong to the profile screen; a registration cannot silently change saved identity data. */
export function assertRetreatProfileMatches(member: MemberRow, input: RetreatRegistrationInput) {
  const locked = (label: string) => { throw new EventError(409, 'PROFILE_FIELD_LOCKED', `저장된 ${label} 정보가 변경되었습니다. 프로필을 확인해 주세요.`); };
  if (normalized(member.name) && normalized(member.name) !== input.participantName) locked('이름');
  if (normalized(member.peer_group) && normalized(member.peer_group) !== input.peerGroup) locked('또래');
  if (member.gender && member.gender !== input.gender) locked('성별');
  if (normalized(member.phone_number)) {
    const storedPhone = phoneNumberInput.safeParse(member.phone_number);
    if (!storedPhone.success || storedPhone.data !== input.phoneNumber) locked('연락처');
  }
}
function answerFields(input: RetreatRegistrationInput): RetreatAnswers {
  return { peerGroup: input.peerGroup, gender: input.gender, phoneNumber: input.phoneNumber,
    departureOption: input.departureOption, departureNote: input.departureNote, prayerRequest: input.prayerRequest };
}

export async function registerForRetreat(pool: Pool, actor: Actor, body: unknown) {
  const input = retreatRegistrationInput.parse(body);
  return transaction(pool, async (client) => {
    const member = ensureActiveMember((await lockMembers(client, [actor.userId]))[0], actor);
    const event = (await client.query<EventRow>('SELECT *,clock_timestamp() AS server_now FROM events WHERE id=$1 FOR UPDATE', [DEMO_EVENT_ID])).rows[0];
    if (!event) throw new EventError(404, 'RETREAT_UNAVAILABLE', '수련회 신청을 준비하고 있습니다.');
    assertCanRegister(event, member, input.expectedEventVersion, new Date(event.server_now!));
    assertRetreatProfileMatches(member, input);
    const current = (await client.query<RegistrationRow>('SELECT * FROM registrations WHERE event_id=$1 AND user_id=$2 FOR UPDATE', [DEMO_EVENT_ID, actor.userId])).rows[0];
    const answers = answerFields(input);
    if (current?.status === 'confirmed') {
      if (normalized(current.participant_name) !== input.participantName || JSON.stringify(retreatAnswersView(current.retreat_answers)) !== JSON.stringify(answers)) {
        throw new EventError(409, 'RETREAT_ALREADY_REGISTERED', '이미 신청했습니다. 내 신청에서 내용을 확인해 주세요.');
      }
      return { registration: current, event };
    }
    if ((current?.version || 0) !== input.expectedRegistrationVersion) throw new EventError(409, 'REGISTRATION_CHANGED', '현재 신청 상태를 확인한 뒤 다시 신청해 주세요.');
    // Only absent profile values are filled. Prayer and transport answers never enter USER.
    await client.query(`UPDATE app_users SET name=CASE WHEN btrim(name)='' THEN $2 ELSE name END,
      peer_group=COALESCE(NULLIF(btrim(peer_group),''),$3),gender=COALESCE(gender,$4),
      phone_number=COALESCE(NULLIF(btrim(phone_number),''),$5),version=version+1,updated_at=now() WHERE user_id=$1`,
    [actor.userId, input.participantName, input.peerGroup, input.gender, input.phoneNumber]);
    const result = current
      ? await client.query<RegistrationRow>(`UPDATE registrations SET participant_name=$2,retreat_answers=$3::jsonb,
        status='confirmed',attendance_status='unmarked',version=version+1,confirmed_at=now(),cancelled_at=NULL,
        checked_by=NULL,checked_at=NULL,confirmation_code=upper(encode(gen_random_bytes(6),'hex')),updated_at=now()
        WHERE id=$1 RETURNING *`, [current.id, input.participantName, JSON.stringify(answers)])
      : await client.query<RegistrationRow>(`INSERT INTO registrations(event_id,user_id,participant_name,retreat_answers)
        VALUES ($1,$2,$3,$4::jsonb) RETURNING *`, [DEMO_EVENT_ID, actor.userId, input.participantName, JSON.stringify(answers)]);
    return { registration: result.rows[0], event };
  });
}

retreatRoutes.get('/retreats/nehemiah-winter', async (c) => {
  const row = (await c.get('pool').query<EventRow>(`SELECT * FROM events WHERE id=$1 AND publication_status='published' AND visibility='public'`, [DEMO_EVENT_ID])).rows[0];
  if (!row) throw new EventError(404, 'RETREAT_UNAVAILABLE', '수련회 안내를 준비하고 있습니다.');
  return c.json({ retreat: { ...nehemiahWinterRetreat, event: publicEvent(row) } }, 200, noStore);
});
retreatRoutes.get('/me/retreats/nehemiah-winter/registration', async (c) => {
  const member = (await getMember(c, { required: true }))!;
  const row = (await c.get('pool').query<RegistrationRow & { event: EventRow }>(`SELECT r.*,to_jsonb(e) AS event
    FROM registrations r JOIN events e ON e.id=r.event_id WHERE r.event_id=$1 AND r.user_id=$2`, [DEMO_EVENT_ID, member.userId])).rows[0];
  return c.json({ registration: row ? { ...registrationView(row, row.event), retreatSlug: RETREAT_SLUG } : null }, 200, noStore);
});
retreatRoutes.post('/retreats/nehemiah-winter/registrations', async (c) => {
  const member = (await getMember(c, { required: true }))!;
  const result = await registerForRetreat(c.get('pool'), member, await c.req.json());
  return c.json({ registration: { ...registrationView(result.registration, result.event), retreatSlug: RETREAT_SLUG } }, 200, noStore);
});
