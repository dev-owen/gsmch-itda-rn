import type { EventItem } from './types';

export type EventPeriod = 'week' | 'all' | 'past';
export interface EventDiscoveryFilters { period: EventPeriod; category: string; query: string }

const dayMs = 24 * 60 * 60 * 1000;
const seoulOffsetMs = 9 * 60 * 60 * 1000;

// Seoul has no daylight-saving changes. Use its calendar day even on devices abroad.
function seoulDayStart(time: number) {
  return Math.floor((time + seoulOffsetMs) / dayMs) * dayMs - seoulOffsetMs;
}

function timestamp(value: string | null) {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function eventEnd(event: EventItem) {
  const time = timestamp(event.endsAt) ?? timestamp(event.startsAt);
  if (time === null) return null;
  // An all-day event remains current through the last displayed calendar day.
  return event.allDay ? seoulDayStart(time) + dayMs - 1 : time;
}

export function isPastEvent(event: EventItem, now: number) {
  const end = eventEnd(event);
  return event.lifecycleStatus === 'completed' || (end !== null && end < now);
}

function byStart(a: EventItem, b: EventItem, direction: 1 | -1 = 1) {
  const startA = timestamp(a.startsAt);
  const startB = timestamp(b.startsAt);
  if (startA === null) return startB === null ? 0 : 1;
  if (startB === null) return -1;
  return (startA - startB) * direction;
}

export function upcomingEvents(events: readonly EventItem[], now: number) {
  return events.filter(event => !isPastEvent(event, now)).sort(byStart);
}

/** Week is today plus six Seoul calendar days. All also includes undated news. */
export function filterEvents(events: readonly EventItem[], filters: EventDiscoveryFilters, now: number) {
  const query = filters.query.trim().toLocaleLowerCase('ko-KR');
  const weekStart = seoulDayStart(now);
  const weekEnd = weekStart + 7 * dayMs;
  const matching = events.filter(event => {
    const past = isPastEvent(event, now);
    if (filters.period === 'past' ? !past : past) return false;
    if (filters.period === 'week') {
      const start = timestamp(event.startsAt);
      const end = eventEnd(event);
      if (start === null || start >= weekEnd || (end !== null && end < weekStart)) return false;
    }
    if (filters.category !== '전체' && event.category !== filters.category) return false;
    const category = event.category === 'event' ? '행사' : event.category === 'recruitment' ? '모집' : event.category;
    return !query || [event.title, category, event.description, event.location, event.target]
      .join(' ').toLocaleLowerCase('ko-KR').includes(query);
  });
  return matching.sort(filters.period === 'past' ? (a, b) => byStart(a, b, -1) : byStart);
}

export function weekRangeLabel(now: number) {
  const start = seoulDayStart(now);
  const format = (time: number) => {
    const date = new Date(time + seoulOffsetMs);
    return `${date.getUTCMonth() + 1}.${String(date.getUTCDate()).padStart(2, '0')}`;
  };
  return `${format(start)} – ${format(start + 6 * dayMs)}`;
}
