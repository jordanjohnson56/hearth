// US holidays, computed from their rules: no feed, no network, the same
// answer offline. Client-safe like monthGrid.ts: local dates are
// `YYYY-MM-DD` text and the arithmetic runs on Date.UTC, so there is no
// zone to get wrong and no Temporal polyfill in the bundle.
import { formatLocalDate, partsOf } from '../../core/localDateText.js';

/**
 * `federal`: one of the eleven legal public holidays (5 U.S.C. 6103), the
 * days federal offices close and most schools and banks follow.
 * `observance`: a day most families mark that is not a day off.
 */
export type HolidayKind = 'federal' | 'observance';

/** One holiday on one local date. */
export interface Holiday {
  /** `YYYY-MM-DD` */
  date: string;
  name: string;
  kind: HolidayKind;
  /**
   * True for the weekday a federal holiday is moved to when its date falls
   * on a weekend: Saturday's moves to the Friday before, Sunday's to the
   * Monday after (5 U.S.C. 6103(b), the OPM rule). The holiday itself is
   * still listed on its own date as well.
   */
  observed: boolean;
}

const SUNDAY = 0;
const MONDAY = 1;
const THURSDAY = 4;
const SATURDAY = 6;

function utc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

function formatUtc(date: Date): string {
  return formatLocalDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/** The `n`th `weekday` (0 is Sunday) of `month`; `n` of -1 is the last one. */
export function nthWeekday(year: number, month: number, weekday: number, n: number): string {
  if (n > 0) {
    const first = utc(year, month, 1).getUTCDay();
    return formatUtc(utc(year, month, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7));
  }
  const lastDay = utc(year, month + 1, 0);
  const back = (lastDay.getUTCDay() - weekday + 7) % 7;
  return formatUtc(utc(year, month, lastDay.getUTCDate() - back));
}

/** Western (Gregorian) Easter Sunday: the anonymous Gregorian computus. */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return formatLocalDate(year, month, day);
}

/** A holiday's rule: its date in a year, or null in a year it did not exist. */
interface Rule {
  name: string;
  kind: HolidayKind;
  /** A fixed date moves to a weekday when it falls on a weekend; a federal one only. */
  date: (year: number) => string | null;
}

const fixed = (month: number, day: number) => (year: number) => formatLocalDate(year, month, day);

// In calendar order, so a year's list comes out sorted before observed days
// are added. Names are the ones families say ("Presidents' Day"), not the
// statute's ("Washington's Birthday").
const RULES: readonly Rule[] = [
  { name: "New Year's Day", kind: 'federal', date: fixed(1, 1) },
  // First observed in 1986.
  {
    name: 'Martin Luther King Jr. Day',
    kind: 'federal',
    date: (year) => (year >= 1986 ? nthWeekday(year, 1, MONDAY, 3) : null),
  },
  { name: "Valentine's Day", kind: 'observance', date: fixed(2, 14) },
  { name: "Presidents' Day", kind: 'federal', date: (year) => nthWeekday(year, 2, MONDAY, 3) },
  { name: "St. Patrick's Day", kind: 'observance', date: fixed(3, 17) },
  { name: 'Easter', kind: 'observance', date: easterSunday },
  { name: "Mother's Day", kind: 'observance', date: (year) => nthWeekday(year, 5, SUNDAY, 2) },
  { name: 'Memorial Day', kind: 'federal', date: (year) => nthWeekday(year, 5, MONDAY, -1) },
  { name: "Father's Day", kind: 'observance', date: (year) => nthWeekday(year, 6, SUNDAY, 3) },
  // A federal holiday from 2021.
  { name: 'Juneteenth', kind: 'federal', date: (year) => (year >= 2021 ? formatLocalDate(year, 6, 19) : null) },
  { name: 'Independence Day', kind: 'federal', date: fixed(7, 4) },
  { name: 'Labor Day', kind: 'federal', date: (year) => nthWeekday(year, 9, MONDAY, 1) },
  { name: 'Columbus Day', kind: 'federal', date: (year) => nthWeekday(year, 10, MONDAY, 2) },
  { name: 'Halloween', kind: 'observance', date: fixed(10, 31) },
  { name: 'Veterans Day', kind: 'federal', date: fixed(11, 11) },
  { name: 'Thanksgiving', kind: 'federal', date: (year) => nthWeekday(year, 11, THURSDAY, 4) },
  { name: 'Christmas Eve', kind: 'observance', date: fixed(12, 24) },
  { name: 'Christmas Day', kind: 'federal', date: fixed(12, 25) },
  { name: "New Year's Eve", kind: 'observance', date: fixed(12, 31) },
];

/**
 * The weekday a federal holiday on `date` is observed on, or null when it
 * falls on a weekday. A Saturday New Year's Day is observed on December 31
 * of the year before.
 */
function observedDate(date: string): string | null {
  const { year, month, day } = partsOf(date);
  const weekday = utc(year, month, day).getUTCDay();
  if (weekday === SATURDAY) return formatUtc(utc(year, month, day - 1));
  if (weekday === SUNDAY) return formatUtc(utc(year, month, day + 1));
  return null;
}

/** Every holiday dated in `year`'s rules, observed days included (which may fall in the year before). */
function holidaysOfYear(year: number): Holiday[] {
  const holidays: Holiday[] = [];
  for (const rule of RULES) {
    const date = rule.date(year);
    if (date === null) continue;
    holidays.push({ date, name: rule.name, kind: rule.kind, observed: false });
    if (rule.kind !== 'federal') continue;
    const observed = observedDate(date);
    if (observed !== null) holidays.push({ date: observed, name: rule.name, kind: 'federal', observed: true });
  }
  return holidays;
}

const KIND_ORDER: Record<HolidayKind, number> = { federal: 0, observance: 1 };

/**
 * The holidays from `first` through `last` (`YYYY-MM-DD`, both included),
 * by date; on one date federal before observance, a holiday's own date
 * before another's observed day.
 */
export function holidaysBetween(first: string, last: string): Holiday[] {
  if (last < first) return [];
  const fromYear = partsOf(first).year;
  // The next year's rules can put an observed New Year's Day on December 31.
  const toYear = partsOf(last).year + 1;
  const found: Holiday[] = [];
  for (let year = fromYear; year <= toYear; year += 1) {
    for (const holiday of holidaysOfYear(year)) {
      if (holiday.date >= first && holiday.date <= last) found.push(holiday);
    }
  }
  return found.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      Number(a.observed) - Number(b.observed),
  );
}

/** holidaysBetween, grouped under each date. */
export function holidaysByDate(first: string, last: string): Map<string, Holiday[]> {
  const byDate = new Map<string, Holiday[]>();
  for (const holiday of holidaysBetween(first, last)) {
    const list = byDate.get(holiday.date);
    if (list) list.push(holiday);
    else byDate.set(holiday.date, [holiday]);
  }
  return byDate;
}

/** How a holiday is labelled where there is room: the day panel and assistive text. */
export function holidayLabel(holiday: Holiday): string {
  return holiday.observed ? `${holiday.name} (observed)` : holiday.name;
}
