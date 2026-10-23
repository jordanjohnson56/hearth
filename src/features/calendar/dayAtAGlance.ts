// What the Day at a glance tile shows, computed from the events route's
// response: pure, so the tile component only renders. Client-safe: local
// dates come from src/core/localDateText.ts, never src/core/time.ts.
import { addDays, localDateOf } from '../../core/localDateText.js';
import type { PersonColor } from '../../core/personColor.js';
import type { CalendarEventWire, EventsResponse } from './types.js';

type AllDayWire = Extract<CalendarEventWire, { kind: 'allDay' }>;
type TimedWire = Extract<CalendarEventWire, { kind: 'timed' }>;

/**
 * How a timed event's span sits against the day shown: `within` starts and
 * ends today; `startsToday` runs on past midnight; `endsToday` began on an
 * earlier day; `coversToday` began earlier and ends later.
 */
export type TimedSpan = 'within' | 'startsToday' | 'endsToday' | 'coversToday';

export type GlanceTiming =
  | { kind: 'allDay' }
  | { kind: 'timed'; span: TimedSpan; startAt: number; endAt: number };

/** One row of the tile, in display order. */
export interface GlanceEvent {
  id: number;
  title: string;
  color: PersonColor;
  sourceLabel: string;
  /**
   * Already finished at `now`: a timed event once its end instant is at or
   * before now; an all-day event once the day after its last day has begun,
   * so one that is showing today is never over.
   */
  over: boolean;
  timing: GlanceTiming;
}

/**
 * The events to show for the local day of `now` in `zone`: all-day events
 * first (earlier start first), then timed events by start. Ties keep the
 * response's order.
 */
export function todaysEvents(response: EventsResponse, now: Date, zone: string): GlanceEvent[] {
  const today = localDateOf(now, zone);
  const sources = new Map(response.sources.map((source) => [source.id, source]));
  const allDay: AllDayWire[] = [];
  const timed: TimedWire[] = [];
  for (const event of response.events) {
    const days = daysOf(event, zone);
    if (!(days.first <= today && today <= days.last)) continue;
    if (event.kind === 'allDay') allDay.push(event);
    else timed.push(event);
  }
  allDay.sort((a, b) => a.startDate.localeCompare(b.startDate));
  timed.sort((a, b) => a.startAt - b.startAt);
  return [...allDay, ...timed].flatMap((event) => {
    const source = sources.get(event.sourceId);
    if (source === undefined) return [];
    return [
      {
        id: event.id,
        title: event.title,
        color: source.color,
        sourceLabel: source.label,
        over: isOver(event, now, today),
        timing: timingOf(event, today, zone),
      },
    ];
  });
}

/** The local days a timed event occupies: its end is exclusive, so the last one holds `endAt - 1 ms`. */
function daysOf(event: CalendarEventWire, zone: string): { first: string; last: string } {
  if (event.kind === 'allDay') return { first: event.startDate, last: addDays(event.endDate, -1) };
  const lastInstant = Math.max(event.startAt, event.endAt - 1);
  return { first: localDateOf(new Date(event.startAt), zone), last: localDateOf(new Date(lastInstant), zone) };
}

function timingOf(event: CalendarEventWire, today: string, zone: string): GlanceTiming {
  if (event.kind === 'allDay') return { kind: 'allDay' };
  const { first, last } = daysOf(event, zone);
  const span: TimedSpan =
    first === today ? (last === today ? 'within' : 'startsToday') : last === today ? 'endsToday' : 'coversToday';
  return { kind: 'timed', span, startAt: event.startAt, endAt: event.endAt };
}

function isOver(event: CalendarEventWire, now: Date, today: string): boolean {
  if (event.kind === 'allDay') return today >= event.endDate;
  return event.endAt <= now.getTime();
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Stale (GLOSSARY): the newest success is older than this. */
export const STALE_AFTER_MS = 60 * MINUTE_MS;

/**
 * The quiet "Calendar updated N ago" line, or undefined when there is
 * nothing to say: no source has succeeded yet (a fresh install is not
 * stale) or the newest success is at most 60 minutes old.
 */
export function stalenessLine(newestSuccessAt: number | null, now: Date): string | undefined {
  if (newestSuccessAt === null) return undefined;
  const age = now.getTime() - newestSuccessAt;
  if (age <= STALE_AFTER_MS) return undefined;
  const [count, unit] = age >= DAY_MS ? [Math.floor(age / DAY_MS), 'day'] : [Math.floor(age / HOUR_MS), 'hour'];
  return `Calendar updated ${count} ${unit}${count === 1 ? '' : 's'} ago`;
}
