// The month page's date math, polyfill-free so it can live in the browser
// bundle (test/clientBundle.test.ts): local dates are `YYYY-MM-DD` text
// (src/core/localDateText.ts) and the month arithmetic runs on Date.UTC,
// which has no zone to get wrong. The server's month math is
// src/core/time.ts (Temporal); the two agree on every date because both
// are the proleptic Gregorian calendar.

import { datesSpanning, formatLocalDate, localDateOf, partsOf } from '../../core/localDateText.js';
import type { CalendarEventWire } from './types.js';
import { MONTHS_AHEAD, MONTHS_BACK } from './windowSize.js';
import { localDaysOf } from './wireEvents.js';

/** One square of the grid. */
export interface GridCell {
  /** `YYYY-MM-DD` */
  date: string;
  /** False for the dimmed days of the previous and next month. */
  inMonth: boolean;
}

/** A month on the wall: `month` is 1-12. */
export interface YearMonth {
  year: number;
  month: number;
}

const DAYS_PER_WEEK = 7;
/**
 * A month fits in four, five or six Sunday-first rows. The grid never shows
 * fewer than five so the page keeps its height from month to month.
 */
const MIN_ROWS = 5;

function formatUtcDate(date: Date): string {
  return formatLocalDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/**
 * The Sunday-first cells of `month` in `year`: from the Sunday on or before
 * the 1st, in whole weeks, through the last day of the month, padded to at
 * least five rows.
 */
export function monthGrid(year: number, month: number): GridCell[] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const leading = first.getUTCDay();
  const rows = Math.max(MIN_ROWS, Math.ceil((leading + daysInMonth) / DAYS_PER_WEEK));
  const cells: GridCell[] = [];
  for (let offset = -leading; offset < rows * DAYS_PER_WEEK - leading; offset += 1) {
    const day = new Date(Date.UTC(year, month - 1, 1 + offset));
    cells.push({ date: formatUtcDate(day), inMonth: day.getUTCMonth() === month - 1 });
  }
  return cells;
}

const CELL_PILL_CAP = 3;

/**
 * Every event under each local date it covers (localDaysOf), each day's
 * list ordered all-day first (in the order given), then timed by start. A
 * multi-day event is listed under every one of its days.
 */
export function eventsByDate<E extends CalendarEventWire>(events: readonly E[], zone: string): Map<string, E[]> {
  const byDate = new Map<string, E[]>();
  const ordered = [...events].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'allDay' ? -1 : 1;
    if (a.kind === 'timed' && b.kind === 'timed') return a.startAt - b.startAt;
    return 0;
  });
  for (const event of ordered) {
    const { first, last } = localDaysOf(event, zone);
    for (const date of datesSpanning(first, last)) {
      const list = byDate.get(date);
      if (list) list.push(event);
      else byDate.set(date, [event]);
    }
  }
  return byDate;
}

/** The first three of a day's events, and how many the cell leaves out. */
export function splitPills<E extends CalendarEventWire>(events: readonly E[]): { shown: E[]; more: number } {
  return { shown: events.slice(0, CELL_PILL_CAP), more: Math.max(0, events.length - CELL_PILL_CAP) };
}

/** `base` plus `months` (may be negative). */
export function addMonths(base: YearMonth, months: number): YearMonth {
  const index = base.year * 12 + (base.month - 1) + months;
  return { year: Math.floor(index / 12), month: (((index % 12) + 12) % 12) + 1 };
}

/** The month a `YYYY-MM-DD` date falls in. */
export function yearMonthOf(date: string): YearMonth {
  const { year, month } = partsOf(date);
  return { year, month };
}

function compare(a: YearMonth, b: YearMonth): number {
  return a.year * 12 + a.month - (b.year * 12 + b.month);
}

/**
 * The first and last months the server keeps occurrences for at `now`:
 * three months back through twelve ahead of the local month in `zone`, as
 * `pollWindow` computes it.
 */
export function loadedMonths(now: Date, zone: string): { first: YearMonth; last: YearMonth } {
  const current = yearMonthOf(localDateOf(now, zone));
  return { first: addMonths(current, -MONTHS_BACK), last: addMonths(current, MONTHS_AHEAD) };
}

/** True when the server has occurrences for `target` (edges inclusive). */
export function isMonthLoaded(target: YearMonth, now: Date, zone: string): boolean {
  const { first, last } = loadedMonths(now, zone);
  return compare(target, first) >= 0 && compare(target, last) <= 0;
}

/** The page's path for a month: `/calendar/<year>/<month>`, month unpadded. */
export function monthPath(target: YearMonth): string {
  return `/calendar/${String(target.year)}/${String(target.month)}`;
}

const YEAR_SEGMENT = /^\d{4}$/;
const MONTH_SEGMENT = /^\d{1,2}$/;

/**
 * The month a calendar path names: `/calendar/<year>/<month>` with a
 * four-digit year and a month 1-12 (zero-padded or not). Anything else,
 * `/calendar` included, is `fallback` (the current month).
 */
export function parseMonthPath(path: string, fallback: YearMonth): YearMonth {
  const [, year, month, ...rest] = path.split('/').filter(Boolean);
  if (year === undefined || month === undefined || rest.length > 0) return fallback;
  if (!YEAR_SEGMENT.test(year) || !MONTH_SEGMENT.test(month)) return fallback;
  const parsed = { year: Number(year), month: Number(month) };
  if (parsed.month < 1 || parsed.month > 12) return fallback;
  return parsed;
}
