// Local-date helpers the browser can use: Intl parts and plain arithmetic on
// `YYYY-MM-DD` text, with no Temporal polyfill (test/clientBundle.test.ts).
// src/core/time.ts has the same operations on the server, with the polyfill;
// localDateText.test.ts checks the two agree across DST, and time.test.ts
// has the fuller edge cases.
import { intlParts } from './intlParts.js';

/** The numbers in a `YYYY-MM-DD`; `month` is 1-12. */
export interface DateParts {
  year: number;
  month: number;
  day: number;
}

const DATE_SHAPE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The parts of a `YYYY-MM-DD`; throws RangeError for any other shape. */
export function partsOf(date: string): DateParts {
  const match = DATE_SHAPE.exec(date);
  if (match === null) throw new RangeError('expected a date as YYYY-MM-DD');
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/** `year`, `month` (1-12) and `day` as `YYYY-MM-DD`. */
export function formatLocalDate(year: number, month: number, day: number): string {
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/**
 * `date` as the instant of its UTC midnight: formatted with timeZone 'UTC',
 * it names that calendar day whatever the device's zone.
 */
export function atUtcMidnight(date: string): Date {
  const { year, month, day } = partsOf(date);
  return new Date(Date.UTC(year, month - 1, day));
}

/**
 * The `YYYY-MM-DD` shown on a wall calendar in `zone` at `instant`. Throws
 * RangeError for an unknown zone, like the clock does.
 */
export function localDateOf(instant: Date, zone: string): string {
  const part = intlParts(instant, zone, { year: 'numeric', month: 'numeric', day: 'numeric' });
  return formatLocalDate(Number(part('year')), Number(part('month')), Number(part('day')));
}

/**
 * `date` (`YYYY-MM-DD`) moved by `days`, negative allowed. Done on the UTC
 * calendar, which has no gaps or overlaps, so the result is the plain
 * calendar answer whatever the zone.
 */
export function addDays(date: string, days: number): string {
  const { year, month, day } = partsOf(date);
  const moved = new Date(Date.UTC(year, month - 1, day + days));
  return formatLocalDate(moved.getUTCFullYear(), moved.getUTCMonth() + 1, moved.getUTCDate());
}

/** Every date from `first` through `last`, both included; empty when `last` is earlier. */
export function datesSpanning(first: string, last: string): string[] {
  const dates: string[] = [];
  for (let date = first; date <= last; date = addDays(date, 1)) dates.push(date);
  return dates;
}
