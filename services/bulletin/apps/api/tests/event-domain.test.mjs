import test from 'node:test';
import assert from 'node:assert/strict';
import { eventInput, registrationInput, publicEvent, memberEvent, registrationWindow } from '../.test-dist/event-domain.js';
import { getMember } from '../.test-dist/event-users.js';

const row = {
  id: '00000000-0000-4000-8000-000000000001', title: '청년 수련회', category: 'event', description: '공개 안내',
  member_details: '로그인 후 안내', location: '본당', target: '청년', starts_at: '2026-12-20T01:00:00Z', ends_at: null,
  all_day: false, visibility: 'public', requires_member_verification: false, publication_status: 'published',
  lifecycle_status: 'active', registration_enabled: true, registration_opens_at: '2026-11-01T00:00:00Z',
  registration_closes_at: '2026-12-10T00:00:00Z', cancellation_closes_at: null, version: 1,
  source_promotion_id: 'private-source-id', secret_internal_field: 'must-not-leak',
};

test('public event representation never exposes private notes, source IDs or unexpected database fields', () => {
  const publicRow = publicEvent(row, new Date('2026-11-13T00:00:00Z'));
  assert.equal(publicRow.registrationStatus, 'open');
  assert.equal(publicRow.memberDetails, undefined);
  assert.equal(publicRow.sourcePromotionId, undefined);
  assert.equal(publicRow.secret_internal_field, undefined);
  assert.equal(memberEvent(row).memberDetails, '로그인 후 안내');
});

test('registration boundaries use start-inclusive/end-exclusive time and independent event/publication states', () => {
  assert.equal(registrationWindow(row, new Date(row.registration_opens_at)), 'open');
  assert.equal(registrationWindow(row, new Date(row.registration_closes_at)), 'closed');
  assert.equal(registrationWindow({ ...row, publication_status: 'hidden' }), 'unavailable');
  assert.equal(registrationWindow({ ...row, lifecycle_status: 'cancelled' }), 'cancelled');
  assert.equal(registrationWindow({ ...row, lifecycle_status: 'completed' }), 'completed');
});

test('event validation separates recruitment deadlines from ordinary event schedules', () => {
  assert.equal(eventInput.safeParse({ title: '일정 미정', registrationEnabled: true, registrationClosesAt: '2026-12-20T00:00:00Z' }).success, false);
  assert.equal(eventInput.safeParse({ title: '팀 모집', category: 'recruitment', registrationEnabled: true, registrationClosesAt: '2026-12-20T00:00:00Z' }).success, true);
  assert.equal(eventInput.safeParse({ title: '행사', startsAt: '2026-12-20T00:00:00Z', registrationEnabled: true, registrationClosesAt: '2026-12-21T00:00:00Z' }).success, false);
  assert.equal(eventInput.safeParse({ title: '행사', startsAt: '2026-12-20T00:00:00Z', endsAt: '2026-12-19T00:00:00Z' }).success, false);
});

test('registration input forbids identity/role injection and normalizes the participant name', () => {
  const input = { participantName: '  홍길동  ', expectedEventVersion: 1 };
  assert.equal(registrationInput.parse(input).participantName, '홍길동');
  assert.equal(registrationInput.parse(input).expectedRegistrationVersion, 0);
  assert.equal(registrationInput.safeParse({ ...input, userId: 'victim', role: 'admin' }).success, false);
  assert.equal(registrationInput.safeParse({ ...input, expectedRegistrationVersion: -1 }).success, false);
});

test('anonymous membership lookups return without initializing auth or touching the database', async () => {
  const context = { req: { raw: new Request('http://localhost/v1/events') }, get: () => { throw new Error('anonymous request touched database'); } };
  assert.equal(await getMember(context), null);
  await assert.rejects(() => getMember(context, { required: true }), { code: 'UNAUTHENTICATED', status: 401 });
});
