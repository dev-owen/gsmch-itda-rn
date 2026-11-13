import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { normalizeBulletin, fetchBulletinSource, bulletinSourceOrigin } from '../.test-dist/bulletin-source.js';

globalThis.crypto ??= webcrypto;
const origin = 'https://bulletin.example';
const schedule = (startDate, fields = {}) => ({ startDate, endDate: startDate, allDay: true, startTime: '', endTime: '', ...fields });
const detail = (title, dates, body = '') => ({ type: 'schedule', title, body, schedule: dates });
const promotion = (fields = {}) => ({ title: '겨울 수련회', body: '함께 참여해 주세요.', details: [], url: '', ...fields });
const envelope = (promotions, fields = {}) => ({ bulletin: { id: 'bulletin-2026-10-25', serviceDate: '2026-10-25', status: 'published', promotions, ...fields } });
const json = (payload, init = {}) => new Response(JSON.stringify(payload), { ...init, headers: { 'content-type': 'application/json; charset=utf-8', ...init.headers } });

test('one promotion becomes one event: explicit event time wins over generic period; recruitment uses its application window', async () => {
  const input = envelope([
    promotion({ title: '젊은이교회 예배안내' }),
    promotion({ title: '셀 초청데이 - HUG "안다"', details: [
      detail('일시 및 장소', schedule('2026-11-15', { allDay: false, startTime: '15:00' }), '본당'),
      detail('기간', schedule('2026-10-25', { endDate: '2026-11-15' })),
    ] }),
    promotion({ title: '하늘꿈학교 프렌즈 선생님 모집', details: [
      { title: '모집인원', body: '12명' }, { title: '활동내용', body: '방과후 학습 멘토링' },
      detail('신청기간', schedule('2026-10-25', { endDate: '2026-11-08' })),
    ] }),
  ]);
  input.bulletin.communityNews = [{ content: 'private-community-list-never-store' }];
  input.calendarEvents = [{ title: 'flattened-duplicate-never-import', startDate: '2026-10-25' }];
  const result = await normalizeBulletin(input, origin);
  assert.equal(result.events.length, 2);
  const [event, recruitment] = result.events;
  assert.equal(event.fields.title, '셀 초청데이 - HUG "안다"');
  assert.equal(event.fields.startsAt, '2026-11-15T06:00:00.000Z');
  assert.equal(event.fields.endsAt, null); assert.equal(event.fields.location, '본당');
  assert.equal(event.reviewRequired, false); assert.deepEqual(event.warnings, ['MISSING_PROMOTION_ID']);
  assert.equal(recruitment.fields.category, 'recruitment');
  assert.equal(recruitment.fields.startsAt, '2026-10-24T15:00:00.000Z');
  assert.equal(recruitment.fields.endsAt, '2026-11-08T14:59:59.999Z');
  assert.equal(recruitment.reviewRequired, false);
  assert.match(recruitment.fields.description, /방과후 학습 멘토링/);
  assert.equal(event.sourceUrl, `${origin}/bulletins/2026-10-25`);
  assert.equal(result.sourceSystem, origin);
  assert.doesNotMatch(JSON.stringify(result), /private-community-list|flattened-duplicate/);
});

test('registration dates never become event dates, and conflicting occurrence dates remain a draft candidate', async () => {
  const result = await normalizeBulletin(envelope([
    promotion({ title: '봄 수련회', details: [detail('신청기간', schedule('2026-11-01'))] }),
    promotion({ title: '가을 수련회', details: [detail('행사일정', schedule('2026-11-01')), detail('일시', schedule('2026-11-02'))] }),
    promotion({ title: '교육 안내', details: [detail('기간', schedule('2026-11-03'))] }),
  ]), origin);
  assert.equal(result.events.length, 3);
  for (const event of result.events) {
    assert.equal(event.reviewRequired, true);
    assert.equal(event.fields.startsAt, null); assert.equal(event.fields.endsAt, null);
  }
  assert.ok(result.events[0].warnings.includes('ONLY_REGISTRATION_WINDOW'));
  assert.ok(result.events[1].warnings.includes('AMBIGUOUS_EVENT_SCHEDULE'));
});

test('recruitment window takes precedence over the eventual activity schedule', async () => {
  const result = await normalizeBulletin(envelope([promotion({ title: '수련회 봉사자 모집', details: [
    detail('활동일정', schedule('2026-12-25')), detail('접수기간', schedule('2026-11-01', { endDate: '2026-11-10' })),
  ] })]), origin);
  assert.equal(result.events[0].fields.startsAt, '2026-10-31T15:00:00.000Z');
  assert.equal(result.events[0].fields.endsAt, '2026-11-10T14:59:59.999Z');
  assert.equal(result.events[0].reviewRequired, false);
});

test('repeated identical explicit schedules are unambiguous; multiple different application windows require review', async () => {
  const result = await normalizeBulletin(envelope([
    promotion({ details: [detail('일시', schedule('2026-11-15')), detail('행사일정', schedule('2026-11-15'))] }),
    promotion({ title: '새가족팀 팀원 모집', details: [detail('신청기간', schedule('2026-11-01')), detail('접수기간', schedule('2026-11-02'))] }),
  ]), origin);
  assert.equal(result.events[0].reviewRequired, false);
  assert.equal(result.events[1].reviewRequired, true);
  assert.ok(result.events[1].warnings.includes('AMBIGUOUS_RECRUITMENT_WINDOW'));
});

test('stable source IDs survive body/date edits and exact event identity survives a new bulletin', async () => {
  const input = envelope([promotion({ title: '겨울   수련회', details: [detail('일시', schedule('2026-12-25'))] })]);
  const first = (await normalizeBulletin(input, origin)).events[0];
  const bodyChange = structuredClone(input); bodyChange.bulletin.promotions[0].body = '새 안내문';
  const editedBody = (await normalizeBulletin(bodyChange, origin)).events[0];
  assert.equal(first.sourceId, editedBody.sourceId); assert.equal(first.identityKey, editedBody.identityKey);
  const newDate = structuredClone(input); newDate.bulletin.promotions[0].details[0].schedule = schedule('2026-12-26');
  const editedDate = (await normalizeBulletin(newDate, origin)).events[0];
  assert.equal(first.sourceId, editedDate.sourceId); assert.notEqual(first.identityKey, editedDate.identityKey);
  const nextWeek = structuredClone(input); nextWeek.bulletin.id = 'next-week'; nextWeek.bulletin.serviceDate = '2026-11-01';
  nextWeek.bulletin.promotions[0].title = '겨울 수련회';
  const repeated = (await normalizeBulletin(nextWeek, origin)).events[0];
  assert.notEqual(first.sourceId, repeated.sourceId); assert.equal(first.identityKey, repeated.identityKey);
  const withId = structuredClone(input); withId.bulletin.promotions[0].id = 'upstream-promotion-id';
  assert.equal((await normalizeBulletin(withId, origin)).events[0].sourceId, 'upstream-promotion-id');
});

test('all-day end dates are inclusive in Seoul and multi-day timed schedules preserve exact times', async () => {
  const result = await normalizeBulletin(envelope([
    promotion({ title: '윤년 교육', schedule: schedule('2024-02-29') }),
    promotion({ title: '밤샘 캠프', schedule: schedule('2026-12-31', { endDate: '2027-01-01', allDay: false, startTime: '23:00', endTime: '01:00' }) }),
  ]), origin);
  assert.equal(result.events[0].fields.startsAt, '2024-02-28T15:00:00.000Z');
  assert.equal(result.events[0].fields.endsAt, '2024-02-29T14:59:59.999Z');
  assert.equal(result.events[1].fields.startsAt, '2026-12-31T14:00:00.000Z');
  assert.equal(result.events[1].fields.endsAt, '2026-12-31T16:00:00.000Z');
});

test('bad envelope, malformed item/date and ambiguous duplicate identities fail the complete snapshot', async () => {
  for (const input of [null, {}, { bulletin: null }, { bulletin: { id: 'a', serviceDate: '2026-11-01' } },
    envelope([promotion({ body: { invalid: true } })]), envelope([promotion({ details: [detail('일시', schedule('2026-02-30'))] })]),
    envelope([promotion({ details: [detail('일시', schedule('2026-11-01', { allDay: false, startTime: '' }))] })]),
    envelope([promotion()], { status: 'draft' })]) {
    await assert.rejects(() => normalizeBulletin(input, origin), { code: 'SOURCE_INVALID_RESPONSE' });
  }
  await assert.rejects(() => normalizeBulletin(envelope([promotion({ title: '겨울  수련회' }), promotion({ title: '겨울 수련회' })]), origin), { code: 'SOURCE_AMBIGUOUS_IDENTITY' });
  await assert.rejects(() => normalizeBulletin(envelope([promotion({ id: 'same' }), promotion({ id: 'same', title: '다른 행사' })]), origin), { code: 'SOURCE_AMBIGUOUS_IDENTITY' });
  assert.deepEqual((await normalizeBulletin(envelope([]), origin)).events, []);
});

test('fetch uses only the configured HTTPS origin and fixed read-only endpoint', async () => {
  const calls = [];
  const result = await fetchBulletinSource(`${origin}/`, async (url, options) => {
    calls.push({ url, options }); return json(envelope([]));
  });
  assert.equal(result.events.length, 0); assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${origin}/v1/bulletins/current`);
  assert.equal(calls[0].options.method, 'GET'); assert.equal(calls[0].options.redirect, 'manual');
  assert.equal(calls[0].options.credentials, 'omit'); assert.equal(calls[0].options.headers.Accept, 'application/json');
  for (const value of ['http://example.com', 'https://user:password@example.com', 'https://example.com/custom',
    'https://example.com/?url=elsewhere', 'https://example.com/#elsewhere', 'invalid']) {
    assert.throws(() => bulletinSourceOrigin(value), { code: 'SOURCE_INVALID_ORIGIN' });
  }
});

test('fetch never follows redirects or accepts an HTTP error, HTML, invalid JSON or incomplete snapshot', async () => {
  for (const [response, code] of [
    [new Response('', { status: 302, headers: { location: 'https://attacker.example' } }), 'SOURCE_HTTP_ERROR'],
    [json(envelope([]), { status: 500 }), 'SOURCE_HTTP_ERROR'],
    [new Response('{}', { headers: { 'content-type': 'text/html' } }), 'SOURCE_INVALID_CONTENT_TYPE'],
    [new Response('not json', { headers: { 'content-type': 'application/json' } }), 'SOURCE_INVALID_JSON'],
    [json({ bulletin: null }), 'SOURCE_INVALID_RESPONSE'],
  ]) {
    let calls = 0;
    await assert.rejects(() => fetchBulletinSource(origin, async () => { calls++; return response; }), { code });
    assert.equal(calls, 1);
  }
  await assert.rejects(() => fetchBulletinSource(origin, async () => { throw new Error('transport unavailable'); }), { code: 'SOURCE_FETCH_FAILED' });
});

test('fetch bounds both declared and streamed bytes, including dishonest Content-Length', async () => {
  await assert.rejects(() => fetchBulletinSource(origin, async () => json(envelope([])), { maxBytes: NaN }), { code: 'SOURCE_INVALID_LIMITS' });
  await assert.rejects(() => fetchBulletinSource(origin, async () => json(envelope([]), { headers: { 'content-length': '2048' } }),
    { maxBytes: 1024 }), { code: 'SOURCE_TOO_LARGE' });
  const body = new Uint8Array(1_025).fill(32);
  await assert.rejects(() => fetchBulletinSource(origin, async () => new Response(body, { headers: {
    'content-type': 'application/json', 'content-length': '1',
  } }), { maxBytes: 1024 }), { code: 'SOURCE_TOO_LARGE' });
});

test('fetch timeout covers a stalled connection and a stalled body and aborts the transport', async () => {
  let signal;
  await assert.rejects(() => fetchBulletinSource(origin, async (_url, options) => { signal = options.signal; return new Promise(() => {}); },
    { timeoutMs: 10 }), { code: 'SOURCE_TIMEOUT' });
  assert.equal(signal.aborted, true);
  let cancelled = false;
  await assert.rejects(() => fetchBulletinSource(origin, async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }),
    { headers: { 'content-type': 'application/json' } }), { timeoutMs: 10 }), { code: 'SOURCE_TIMEOUT' });
  assert.equal(cancelled, true);
});
