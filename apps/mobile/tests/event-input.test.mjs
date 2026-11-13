import test from 'node:test';
import assert from 'node:assert/strict';
import { writableEvent } from '../src/domain/event-input.ts';

test('editing a loaded admin response preserves settings while excluding read-only response fields', () => {
  const original = {
    id: 'event-id', title: '수련회', category: 'event', description: '공개 안내', memberDetails: '참여 안내',
    location: '본당', target: '젊은이교회', startsAt: '2026-12-01T06:00:00Z', endsAt: null, allDay: false,
    visibility: 'public', requiresMemberVerification: true, publicationStatus: 'hidden', lifecycleStatus: 'active',
    registrationEnabled: true, registrationOpensAt: null, registrationClosesAt: '2026-11-30T14:59:00Z',
    cancellationClosesAt: null, sourcePromotionId: 'source-id', sourceBulletinId: 'bulletin-id', sourceUrl: 'https://example.org',
    version: 4, createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-02T00:00:00Z', registrationStatus: 'unavailable', expectedVersion: 4,
  };
  const payload = writableEvent(original);
  assert.equal(payload.expectedVersion, 4);
  assert.equal(payload.registrationEnabled, true);
  assert.equal(payload.publicationStatus, 'hidden');
  assert.equal(payload.sourcePromotionId, 'source-id');
  assert.equal(payload.memberDetails, '참여 안내');
  for (const field of ['id', 'version', 'createdAt', 'updatedAt', 'registrationStatus', 'sourceUrl', 'sourceBulletinId']) {
    assert.equal(Object.hasOwn(payload, field), false, `${field} is not writable`);
  }
});
