import { z } from 'zod';
import { dateSchema, promotionScheduleInput } from './validation.js';
import { BULLETIN_SOURCE_ORIGIN, type SourceEvent, type SourceFields, type SourceSnapshot } from './event-sync-types.js';

export const BULLETIN_FETCH_TIMEOUT_MS = 20_000;
export const BULLETIN_MAX_BYTES = 1_048_576;

export class BulletinSourceError extends Error {
  constructor(public code: string, message = '주보 원본을 확인하지 못했습니다. 기존 행사 정보는 유지됩니다.') {
    super(message); this.name = 'BulletinSourceError';
  }
}

const text = (max: number) => z.string().trim().max(max);
const identifier = text(200).min(1).refine((value) => !/[\u0000-\u001f\u007f]/u.test(value));
const detailSchema = z.object({
  type: z.enum(['text', 'schedule']).optional(), title: text(160).min(1), body: text(10_000).default(''),
  schedule: promotionScheduleInput.optional(),
}).superRefine((detail, context) => {
  if (detail.type === 'schedule' && !detail.schedule) context.addIssue({ code: 'custom', path: ['schedule'], message: 'Missing schedule' });
});
const promotionSchema = z.object({
  id: identifier.optional(), title: text(160).min(1), body: text(10_000),
  details: z.array(detailSchema).max(50).default([]), schedule: promotionScheduleInput.optional(),
  url: text(2_000).nullable().optional(),
});
const payloadSchema = z.object({ bulletin: z.object({
  id: identifier, serviceDate: dateSchema, status: z.literal('published').optional(),
  promotions: z.array(promotionSchema).max(100),
}) });
type Promotion = z.infer<typeof promotionSchema>;
type Schedule = z.infer<typeof promotionScheduleInput>;
type Candidate = { title: string; body: string; schedule: Schedule; kind: 'event' | 'registration' | 'generic'; priority: number };

/** A configured origin only. Callers cannot supply a path, query, credentials or redirect URL. */
export function bulletinSourceOrigin(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Invalid origin');
    return url.origin;
  } catch { throw new BulletinSourceError('SOURCE_INVALID_ORIGIN'); }
}

export function normalizedSourceTitle(title: string): string {
  return title.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
}

async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function scheduleKind(title: string): Pick<Candidate, 'kind' | 'priority'> {
  const label = normalizedSourceTitle(title).replace(/\s+/gu, '');
  // Admission windows are never inferred to be an event's occurrence time.
  if (/신청|접수|등록|모집|지원|예약|납부|마감/u.test(label)) return { kind: 'registration', priority: 3 };
  if (/일시|행사일정|행사기간|진행일정|진행기간|교육일정|교육기간|훈련일정|훈련기간|활동일정|활동기간|모임일정|모임기간|일자/u.test(label)) {
    return { kind: 'event', priority: 5 };
  }
  if (label === '일정') return { kind: 'event', priority: 4 };
  return { kind: 'generic', priority: 1 };
}

function times(schedule: Schedule): Pick<SourceFields, 'startsAt' | 'endsAt' | 'allDay'> {
  const at = (date: string, clock: string) => new Date(`${date}T${clock}+09:00`).toISOString();
  return schedule.allDay
    ? { startsAt: at(schedule.startDate, '00:00:00.000'), endsAt: at(schedule.endDate, '23:59:59.999'), allDay: true }
    : { startsAt: at(schedule.startDate, `${schedule.startTime}:00.000`),
      endsAt: schedule.endTime ? at(schedule.endDate, `${schedule.endTime}:00.000`) : null, allDay: false };
}

function uniqueSchedule(candidates: Candidate[]): Candidate | null {
  if (!candidates.length) return null;
  const priority = Math.max(...candidates.map((candidate) => candidate.priority));
  const best = candidates.filter((candidate) => candidate.priority === priority);
  return new Set(best.map((candidate) => JSON.stringify(times(candidate.schedule)))).size === 1 ? best[0] : null;
}

function sourceFields(promotion: Promotion): { fields: SourceFields; reviewRequired: boolean; warnings: string[] } | null {
  const category = /모집|채용|지원자|팀원\s*신청/u.test(promotion.title) ? 'recruitment' : 'event';
  const candidates: Candidate[] = promotion.details.flatMap((detail) => detail.schedule
    ? [{ title: detail.title, body: detail.body, schedule: detail.schedule, ...scheduleKind(detail.title) }] : []);
  if (promotion.schedule) candidates.push({ title: promotion.title, body: '', schedule: promotion.schedule,
    kind: category === 'recruitment' ? 'registration' : 'event', priority: 6 });
  if (!candidates.length && category !== 'recruitment'
    && !/수련회|캠프|행사|초청|특강|세미나|훈련|교육|봉사|선교|수료|졸업|축제|워크숍|컨퍼런스/u.test(promotion.title)) return null;

  const warnings: string[] = [];
  let selected: Candidate | null = null;
  if (category === 'recruitment') {
    const recruitment = candidates.filter((candidate) => candidate.kind === 'registration');
    const eligible = recruitment.length ? recruitment : candidates.filter((candidate) => candidate.kind === 'generic');
    selected = uniqueSchedule(eligible);
    if (!selected) warnings.push(eligible.length ? 'AMBIGUOUS_RECRUITMENT_WINDOW' : 'NO_RECRUITMENT_WINDOW');
  } else {
    const occurrence = candidates.filter((candidate) => candidate.kind === 'event');
    selected = uniqueSchedule(occurrence);
    if (!selected) warnings.push(occurrence.length ? 'AMBIGUOUS_EVENT_SCHEDULE'
      : candidates.some((candidate) => candidate.kind === 'registration') ? 'ONLY_REGISTRATION_WINDOW'
      : candidates.length ? 'AMBIGUOUS_EVENT_SCHEDULE' : 'NO_SCHEDULE');
  }
  const description = [promotion.body, ...promotion.details.map((detail) => {
    const schedule = detail.schedule;
    const dateText = schedule ? `${schedule.startDate}${schedule.allDay ? '' : ` ${schedule.startTime}`}`
      + (schedule.endDate !== schedule.startDate || schedule.endTime
        ? ` ~ ${schedule.endDate}${schedule.allDay || !schedule.endTime ? '' : ` ${schedule.endTime}`}` : '') : '';
    return `${detail.title}: ${[detail.body, dateText].filter(Boolean).join(' · ')}`;
  })].filter(Boolean).join('\n\n');
  const locationDetails = promotion.details.filter((detail) => /^(?:행사|진행|활동|교육|모임)?\s*장소$/u.test(detail.title));
  const location = locationDetails.map((detail) => detail.body).filter(Boolean).join(' · ')
    || (selected && /장소/u.test(selected.title) ? selected.body : '');
  const target = promotion.details.filter((detail) => /^(?:참여|참가|모집|신청|활동)?\s*대상$/u.test(detail.title))
    .map((detail) => detail.body).filter(Boolean).join(' · ');
  if (description.length > 10_000 || location.length > 300 || target.length > 300) throw new BulletinSourceError('SOURCE_FIELDS_TOO_LARGE');
  return { fields: { title: promotion.title.normalize('NFC'), category, description, location, target,
    ...(selected ? times(selected.schedule) : { startsAt: null, endsAt: null, allDay: false }) },
  reviewRequired: !selected, warnings };
}

/** Parse the complete envelope first; a bad item must never turn into a partial snapshot. */
export async function normalizeBulletin(payload: unknown, sourceOrigin = BULLETIN_SOURCE_ORIGIN): Promise<SourceSnapshot> {
  const origin = bulletinSourceOrigin(sourceOrigin);
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) throw new BulletinSourceError('SOURCE_INVALID_RESPONSE');
  const { bulletin } = parsed.data;
  const titles = new Set<string>();
  const ids = new Set<string>();
  for (const promotion of bulletin.promotions) {
    const title = normalizedSourceTitle(promotion.title);
    if (titles.has(title) || (promotion.id && ids.has(promotion.id))) throw new BulletinSourceError('SOURCE_AMBIGUOUS_IDENTITY');
    titles.add(title); if (promotion.id) ids.add(promotion.id);
  }
  const events: SourceEvent[] = [];
  for (const promotion of bulletin.promotions) {
    const normalized = sourceFields(promotion);
    if (!normalized) continue;
    const titleKey = normalizedSourceTitle(promotion.title);
    const identityKey = await hash(JSON.stringify([titleKey, normalized.fields.category,
      normalized.fields.startsAt, normalized.fields.endsAt, normalized.fields.allDay]));
    events.push({ sourceId: promotion.id ?? `legacy:${bulletin.id}:${await hash(titleKey)}`, identityKey,
      bulletinId: bulletin.id, bulletinDate: bulletin.serviceDate, sourceUrl: `${origin}/bulletins/${bulletin.serviceDate}`,
      ...normalized, warnings: [...normalized.warnings, ...(!promotion.id ? ['MISSING_PROMOTION_ID'] : [])] });
  }
  return { sourceSystem: origin, bulletinId: bulletin.id, bulletinDate: bulletin.serviceDate, events };
}

/** Limit overrides only shorten the production limits and are useful for deterministic tests. */
type FetchLimits = { timeoutMs?: number; maxBytes?: number };
export async function fetchBulletinSource(origin: string, fetcher: typeof fetch = fetch, limits: FetchLimits = {}): Promise<SourceSnapshot> {
  const sourceOrigin = bulletinSourceOrigin(origin);
  const url = `${sourceOrigin}/v1/bulletins/current`;
  const boundedLimit = (value: number | undefined, maximum: number) => {
    if (value !== undefined && (!Number.isInteger(value) || value <= 0)) throw new BulletinSourceError('SOURCE_INVALID_LIMITS');
    return Math.min(value ?? maximum, maximum);
  };
  const maxBytes = boundedLimit(limits.maxBytes, BULLETIN_MAX_BYTES);
  const timeoutMs = boundedLimit(limits.timeoutMs, BULLETIN_FETCH_TIMEOUT_MS);
  const abort = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { abort.abort(); reject(new BulletinSourceError('SOURCE_TIMEOUT')); }, timeoutMs);
  });
  const work = async (): Promise<SourceSnapshot> => {
    const response = await fetcher(url, { method: 'GET', credentials: 'omit', redirect: 'manual', signal: abort.signal,
      headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' } });
    if (abort.signal.aborted) { void response.body?.cancel().catch(() => {}); throw new BulletinSourceError('SOURCE_TIMEOUT'); }
    if (response.status !== 200 || response.redirected || (response.url && response.url !== url)) throw new BulletinSourceError('SOURCE_HTTP_ERROR');
    if (!/^application\/(?:json|[a-z0-9.+-]+\+json)(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) throw new BulletinSourceError('SOURCE_INVALID_CONTENT_TYPE');
    const length = response.headers.get('content-length');
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) throw new BulletinSourceError('SOURCE_TOO_LARGE');
    if (!response.body) throw new BulletinSourceError('SOURCE_INVALID_RESPONSE');
    reader = response.body.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBytes) throw new BulletinSourceError('SOURCE_TOO_LARGE');
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let payload: unknown;
    try { payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { throw new BulletinSourceError('SOURCE_INVALID_JSON'); }
    return normalizeBulletin(payload, sourceOrigin);
  };
  try { return await Promise.race([work(), timeout]); }
  catch (error) {
    abort.abort();
    if (error instanceof BulletinSourceError) throw error;
    throw new BulletinSourceError('SOURCE_FETCH_FAILED');
  } finally {
    clearTimeout(timer!);
    if (reader) {
      void reader.cancel().catch(() => {});
      try { reader.releaseLock(); } catch { /* An aborted transport may still be releasing a read. */ }
    }
  }
}
