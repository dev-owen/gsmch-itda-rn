import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { buildMergePlan, hashMergeSnapshot, recentProof, constantTimeEqual } from '../.test-dist/account-merge.js';
import { isAccountCallbackAllowed, isAccountOriginAllowed } from '../.test-dist/account-security.js';
import { previewFor } from '../.test-dist/account-store.js';

globalThis.crypto ??= webcrypto;
const user = (id, fields = {}) => ({ user_id: id, name: id, role: 'user', status: 'active',
  is_member_verified: false, member_verification_revoked_at: null, version: 1, auth_version: 1, ...fields });
const registration = (id, userId, fields = {}) => ({ id, user_id: userId, event_id: 'event-1', status: 'confirmed', attendance_status: 'unmarked', version: 1, ...fields });
const snapshot = (fields = {}) => ({ users: [user('primary'), user('secondary')], accounts: [], events: [], registrations: [], ...fields });
const answers = (fields = {}) => ({ peerGroup: '99', gender: 'female', phoneNumber: '01012345678',
  departureOption: 'main', departureNote: null, prayerRequest: 'PRIVATE_PRAYER_REQUEST', ...fields });

test('keeps the explicitly selected primary user and requires two distinct active users', () => {
  assert.equal(buildMergePlan(snapshot(), 'primary').targetUserId, 'primary');
  assert.throws(() => buildMergePlan(snapshot({ users: [user('same'), user('same')] }), 'same'));
  assert.throws(() => buildMergePlan(snapshot({ users: [user('primary'), user('secondary', { status: 'merged' })] }), 'primary'));
  assert.throws(() => buildMergePlan(snapshot(), 'unproven-user'));
});

test('preserves the existing administrator ID without transferring administrator rights to a new ID', () => {
  const plan = buildMergePlan(snapshot({ users: [user('primary'), user('secondary', { role: 'admin' })] }), 'primary');
  assert.equal(plan.targetUserId, 'secondary');
  assert.equal(plan.sourceUserId, 'primary');
  assert.equal(plan.requiresAdminApproval, true);
});

test('any explicit membership revocation survives a merge with a verified profile', () => {
  const plan = buildMergePlan(snapshot({ users: [user('primary', { is_member_verified: true }),
    user('secondary', { member_verification_revoked_at: '2026-10-01T00:00:00Z' })] }), 'primary');
  assert.equal(plan.memberVerified, false);
  assert.equal(plan.memberVerificationRevokedAt, '2026-10-01T00:00:00.000Z');
});

test('a confirmed secondary registration wins over a cancelled primary registration', () => {
  const plan = buildMergePlan(snapshot({ registrations: [registration('cancelled', 'primary', { status: 'cancelled' }),
    registration('active', 'secondary', { attendance_status: 'present', confirmation_code: 'SOURCE' })] }), 'primary');
  assert.deepEqual(plan.actions, [{ eventId: 'event-1', keepId: 'active', removeId: 'cancelled', attendanceStatus: 'present', attendanceFromId: 'active' }]);
});

test('ties keep the primary registration while retaining an explicit secondary attendance mark', () => {
  const plan = buildMergePlan(snapshot({ registrations: [registration('primary-registration', 'primary'),
    registration('secondary-registration', 'secondary', { attendance_status: 'present' })] }), 'primary');
  assert.equal(plan.actions[0].keepId, 'primary-registration');
  assert.equal(plan.actions[0].attendanceFromId, 'secondary-registration');
  assert.equal(plan.actions[0].attendanceStatus, 'present');
});

test('conflicting explicit attendance values block confirmation instead of picking either value', () => {
  const plan = buildMergePlan(snapshot({ registrations: [registration('a', 'primary', { attendance_status: 'present' }),
    registration('b', 'secondary', { attendance_status: 'absent' })] }), 'primary');
  assert.deepEqual(plan.conflicts, [{ eventId: 'event-1', code: 'ATTENDANCE_CONFLICT' }]);
});

test('different participant names and cancelled registrations with attendance need explicit resolution', () => {
  const differentNames = buildMergePlan(snapshot({ registrations: [registration('a', 'primary', { participant_name: '홍길동' }),
    registration('b', 'secondary', { participant_name: '다른 사람' })] }), 'primary');
  assert.equal(differentNames.conflicts[0].code, 'REGISTRATION_NAME_CONFLICT');
  const invalidState = buildMergePlan(snapshot({ registrations: [registration('a', 'primary', { status: 'cancelled', attendance_status: 'present' })] }), 'primary');
  assert.equal(invalidState.conflicts[0].code, 'REGISTRATION_STATE_CONFLICT');
});

test('different answers on two confirmed retreat registrations require explicit resolution', () => {
  const conflicting = snapshot({ registrations: [registration('a', 'primary', { retreat_answers: answers() }),
    registration('b', 'secondary', { retreat_answers: answers({ departureOption: 'late' }) })] });
  assert.ok(buildMergePlan(conflicting, 'primary').conflicts.some((conflict) => conflict.code === 'REGISTRATION_ANSWERS_CONFLICT'));
  const missing = snapshot({ registrations: [registration('a', 'primary', { retreat_answers: null }),
    registration('b', 'secondary', { retreat_answers: answers() })] });
  assert.ok(buildMergePlan(missing, 'primary').conflicts.some((conflict) => conflict.code === 'REGISTRATION_ANSWERS_CONFLICT'));
  const reordered = Object.fromEntries(Object.entries(answers()).reverse());
  assert.deepEqual(buildMergePlan(snapshot({ registrations: [registration('a', 'primary', { retreat_answers: answers() }),
    registration('b', 'secondary', { retreat_answers: reordered })] }), 'primary').conflicts, []);
});

test('a confirmed registration keeps its own answers instead of copying answers from a cancellation', () => {
  const records = [registration('cancelled', 'primary', { status: 'cancelled', retreat_answers: answers({ prayerRequest: 'OLD_CANCELLED_PRIVATE' }) }),
    registration('confirmed', 'secondary', { retreat_answers: answers() })];
  const plan = buildMergePlan(snapshot({ registrations: records }), 'primary');
  assert.deepEqual(plan.conflicts, []);
  assert.equal(plan.actions[0].keepId, 'confirmed');
  assert.equal(records.find((row) => row.id === plan.actions[0].keepId).retreat_answers.prayerRequest, 'PRIVATE_PRAYER_REQUEST');
});

test('profile merge keeps the actual surviving account values and fills only missing fields', () => {
  const plan = buildMergePlan(snapshot({ users: [user('primary', { peer_group: '98', gender: null, phone_number: '01011112222' }),
    user('secondary', { peer_group: '99', gender: 'other', phone_number: '01033334444' })] }), 'primary');
  assert.deepEqual(plan.profile, { peerGroup: '98', gender: 'other', phoneNumber: '01011112222' });
  const adminSurvives = buildMergePlan(snapshot({ users: [user('primary', { peer_group: '98', gender: 'male' }),
    user('secondary', { role: 'admin', peer_group: '99', phone_number: '01033334444' })] }), 'primary');
  assert.equal(adminSurvives.targetUserId, 'secondary');
  assert.deepEqual(adminSurvives.profile, { peerGroup: '99', gender: 'male', phoneNumber: '01033334444' });
});

test('merge preview signals retreat answers without exposing profile contact or prayer contents', () => {
  const state = snapshot({ users: [user('primary', { phone_number: '01012345678', peer_group: '99', gender: 'female' }), user('secondary')],
    registrations: [registration('a', 'primary', { retreat_answers: answers() })] });
  const preview = previewFor(state, buildMergePlan(state, 'primary'), 'snapshot-hash');
  assert.equal(preview.registrationResults[0].hasRetreatAnswers, true);
  assert.doesNotMatch(JSON.stringify(preview), /PRIVATE_PRAYER_REQUEST|01012345678|prayerRequest|phone_number|phoneNumber|retreat_answers/);
});

test('account callbacks admit exact configured native/web screens and reject external redirects', () => {
  const origins = ['https://church.example', 'itda://', 'http://localhost:8081'];
  for (const callback of ['itda://auth/callback', 'itda:///auth/callback', '/account/login-methods',
    'https://church.example/account/login-methods', 'http://localhost:8081/auth/callback']) {
    assert.equal(isAccountCallbackAllowed(callback, origins), true, callback);
  }
  for (const callback of ['//attacker.example/account', 'https://church.example.attacker.example/account',
    'https://attacker.example/account', 'itda://attacker/auth/callback', 'itda://auth/callback?redirect=attacker',
    'https://church.example/account?next=https://attacker.example', 'otherapp://auth/callback']) {
    assert.equal(isAccountCallbackAllowed(callback, origins), false, callback);
  }
  assert.equal(isAccountOriginAllowed('http://localhost:8081', origins, 'https://api.example'), true);
  assert.equal(isAccountOriginAllowed('itda://', origins, 'https://api.example'), true);
  assert.equal(isAccountOriginAllowed('https://attacker.example', origins, 'https://api.example'), false);
});

test('snapshot hashes ignore property/row ordering but detect new rows and any protected value change', async () => {
  const original = snapshot({ registrations: [registration('a', 'primary')], accounts: [{ id: 'a', providerId: 'google', accountId: 'subject', userId: 'primary' }] });
  const hash = await hashMergeSnapshot(original);
  assert.equal(await hashMergeSnapshot({ ...original, users: [...original.users].reverse() }), hash);
  assert.notEqual(await hashMergeSnapshot({ ...original, registrations: [...original.registrations, registration('b', 'secondary', { event_id: 'new-event' })] }), hash);
  assert.notEqual(await hashMergeSnapshot({ ...original, users: [user('primary', { auth_version: 2 }), user('secondary')] }), hash);
  assert.notEqual(await hashMergeSnapshot({ ...original, accounts: [{ ...original.accounts[0], accountId: 'different-subject' }] }), hash);
  assert.notEqual(await hashMergeSnapshot({ ...original, registrations: [registration('a', 'primary', { participant_name: 'changed' })] }), hash);
  const retreatSnapshot = snapshot({ registrations: [registration('a', 'primary', { retreat_answers: answers() })] });
  const retreatHash = await hashMergeSnapshot(retreatSnapshot);
  assert.notEqual(await hashMergeSnapshot({ ...retreatSnapshot, registrations: [registration('a', 'primary', {
    retreat_answers: answers({ prayerRequest: 'CHANGED_PRIVATE_PRAYER' }) })] }), retreatHash);
  assert.notEqual(await hashMergeSnapshot({ ...retreatSnapshot, users: [user('primary', { phone_number: '01012345678' }), user('secondary')] }), retreatHash);
});

test('fresh proof expires after five minutes and rejects invalid/future timestamps', () => {
  const now = Date.parse('2026-11-13T01:00:00Z');
  assert.equal(recentProof('2026-11-13T00:56:00Z', now), true);
  assert.equal(recentProof('2026-11-13T00:54:59Z', now), false);
  assert.equal(recentProof('2026-11-13T01:05:00Z', now), false);
  assert.equal(recentProof('invalid', now), false);
  assert.equal(constantTimeEqual('abcdef', 'abcdef'), true);
  assert.equal(constantTimeEqual('abcdef', 'abcdeg'), false);
  assert.equal(constantTimeEqual('abcdef', 'abcdefg'), false);
});
