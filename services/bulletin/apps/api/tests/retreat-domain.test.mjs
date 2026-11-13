import test from 'node:test';
import assert from 'node:assert/strict';
import { retreatRegistrationInput } from '../.test-dist/retreat-validation.js';
import { assertRetreatProfileMatches } from '../.test-dist/retreats.js';
import { nehemiahWinterRetreat, DEMO_EVENT_ID } from '../.test-dist/retreat-content.js';
import { publicEvent, retreatAnswersView } from '../.test-dist/event-domain.js';

const raw = { participantName: '홍길동', peerGroup: '96또래', gender: 'male', phoneNumber: '010-1234-5678',
  departureOption: 'main', departureNote: null, prayerRequest: '함께 기도해 주세요.', expectedEventVersion: 1, expectedRegistrationVersion: 0 };

test('retreat profile lock compares normalized saved values and rejects every client-side identity change', () => {
  const input = retreatRegistrationInput.parse(raw);
  const profile = { name: raw.participantName, peer_group: raw.peerGroup, gender: raw.gender, phone_number: raw.phoneNumber };
  assert.doesNotThrow(() => assertRetreatProfileMatches(profile, input));
  for (const [key, value] of [['participantName','다른 이름'],['peerGroup','다른 또래'],['gender','female'],['phoneNumber','01000000000']]) {
    assert.throws(() => assertRetreatProfileMatches(profile, { ...input, [key]: value }), { code: 'PROFILE_FIELD_LOCKED' });
  }
  assert.doesNotThrow(() => assertRetreatProfileMatches({ name: '', peer_group: null, gender: null, phone_number: null }, input));
});

test('retreat answers are a validated field whitelist and transport/prayer never become public event fields', () => {
  const input = retreatRegistrationInput.parse(raw);
  const answers = retreatAnswersView({ ...input, injectedSecret: 'never-return' });
  assert.equal(answers.phoneNumber, '01012345678'); assert.equal(answers.prayerRequest, raw.prayerRequest);
  assert.equal(answers.participantName, undefined); assert.equal(answers.injectedSecret, undefined);
  assert.equal(retreatAnswersView({ phoneNumber: 'broken' }), null);
  const event = publicEvent({ id: DEMO_EVENT_ID, title: '가상 행사', is_demo: true, version: 1,
    publication_status: 'published', lifecycle_status: 'active', registration_enabled: false,
    retreat_answers: answers, phone_number: '01012345678', member_details: '비공개' });
  assert.equal(event.isDemo, true); assert.equal(event.retreatSlug, 'nehemiah-winter');
  assert.equal(event.retreat_answers, undefined); assert.equal(event.phone_number, undefined); assert.equal(event.memberDetails, undefined);
});

test('fictional retreat content has explicit demo/location labels and the four agreed departure choices', () => {
  assert.equal(nehemiahWinterRetreat.isDemo, true);
  assert.match(nehemiahWinterRetreat.description, /가상/); assert.match(nehemiahWinterRetreat.location.name, /가상/);
  assert.deepEqual(nehemiahWinterRetreat.departureOptions.map((choice) => choice.id), ['main','late','car','other']);
  assert.equal(nehemiahWinterRetreat.schedule.length, 3);
});
