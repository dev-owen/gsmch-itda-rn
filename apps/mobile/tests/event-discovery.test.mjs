import test from 'node:test';
import assert from 'node:assert/strict';
import { filterEvents, isPastEvent, upcomingEvents, weekRangeLabel } from '../src/domain/event-discovery.ts';

const now = Date.parse('2026-11-13T12:00:00+09:00');
const filters = { period: 'week', category: '전체', query: '' };
function event(id, fields = {}) {
  return { id, title: id, category: 'event', description: '', location: '', target: '', startsAt: null, endsAt: null,
    allDay: false, lifecycleStatus: 'active', ...fields };
}
const ids = events => events.map(item => item.id);

test('the week follows seven Seoul calendar days and excludes already ended news', () => {
  const events = [
    event('just before window', { startsAt: '2026-11-12T14:59:59Z' }),
    event('ended this morning', { startsAt: '2026-11-13T00:00:00+09:00', endsAt: '2026-11-13T11:00:00+09:00' }),
    event('ongoing', { startsAt: '2026-11-12T10:00:00+09:00', endsAt: '2026-11-14T10:00:00+09:00' }),
    event('next day', { startsAt: '2026-11-13T15:00:00Z' }),
    event('last second', { startsAt: '2026-11-19T14:59:59Z' }),
    event('outside', { startsAt: '2026-11-19T15:00:00Z' }),
    event('undated'),
    event('completed', { startsAt: '2026-11-14T09:00:00+09:00', lifecycleStatus: 'completed' }),
  ];
  assert.deepEqual(ids(filterEvents(events, filters, now)), ['ongoing', 'next day', 'last second']);
});

test('all-day events remain visible until the end of their last Seoul date', () => {
  const oneDay = event('one day', { startsAt: '2026-11-12T15:00:00Z', allDay: true });
  const multipleDays = event('multiple days', { startsAt: '2026-11-10T15:00:00Z', endsAt: '2026-11-12T15:00:00Z', allDay: true });
  const previousDay = event('previous day', { startsAt: '2026-11-11T15:00:00Z', allDay: true });
  assert.deepEqual(ids(filterEvents([oneDay, multipleDays, previousDay], filters, now)), ['multiple days', 'one day']);
  assert.equal(isPastEvent(oneDay, Date.parse('2026-11-13T14:59:59.999Z')), false);
  assert.equal(isPastEvent(oneDay, Date.parse('2026-11-13T15:00:00Z')), true);
});

test('all upcoming news includes undated and cancelled announcements without mutating input', () => {
  const events = [
    event('undated'),
    event('invalid date', { startsAt: 'not-a-date' }),
    event('later', { startsAt: '2026-12-01T09:00:00+09:00' }),
    event('cancelled', { startsAt: '2026-11-14T09:00:00+09:00', lifecycleStatus: 'cancelled' }),
    event('past start only', { startsAt: '2026-11-12T09:00:00+09:00' }),
    event('completed undated', { lifecycleStatus: 'completed' }),
  ];
  const original = [...events];
  assert.deepEqual(ids(upcomingEvents(events, now)), ['cancelled', 'later', 'undated', 'invalid date']);
  assert.deepEqual(ids(filterEvents(events, { ...filters, period: 'all' }, now)), ['cancelled', 'later', 'undated', 'invalid date']);
  assert.deepEqual(events, original);
});

test('past news includes start-only and explicitly completed events, newest first', () => {
  const events = [
    event('older', { startsAt: '2026-11-01T09:00:00+09:00' }),
    event('recent', { startsAt: '2026-11-12T09:00:00+09:00' }),
    event('completed', { startsAt: '2026-11-13T09:00:00+09:00', lifecycleStatus: 'completed' }),
    event('upcoming', { startsAt: '2026-11-14T09:00:00+09:00' }),
  ];
  assert.deepEqual(ids(filterEvents(events, { ...filters, period: 'past' }, now)), ['completed', 'recent', 'older']);
  assert.deepEqual(ids(filterEvents([event('completed undated', { lifecycleStatus: 'completed' }), ...events],
    { ...filters, period: 'past' }, now)), ['completed', 'recent', 'older', 'completed undated']);
});

test('search combines category with title, translated category, description, place and target', () => {
  const events = [
    event('retreat', { title: 'WINTER 수련회', category: 'recruitment', description: '기도로 함께해요', location: '비전센터', target: '새가족' }),
    event('worship', { title: '예배', location: '본당' }),
  ];
  for (const query of [' winter ', '모집', '기도', '비전', '새가족']) {
    assert.deepEqual(ids(filterEvents(events, { ...filters, period: 'all', query }, now)), ['retreat']);
  }
  assert.deepEqual(ids(filterEvents(events, { ...filters, period: 'all', category: 'event', query: '비전' }, now)), []);
  assert.deepEqual(ids(filterEvents(events, { ...filters, period: 'all', query: '행사' }, now)), ['worship']);
});

test('week labels cross month and year boundaries using Seoul dates', () => {
  assert.equal(weekRangeLabel(now), '11.13 – 11.19');
  assert.equal(weekRangeLabel(Date.parse('2026-12-30T15:00:00Z')), '12.31 – 1.06');
});
