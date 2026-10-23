import { describe, expect, it } from 'vitest';
import {
  InvalidInstantError,
  InvalidTimeZoneError,
  addDays,
  addMonths,
  daysBetween,
  endOfMonth,
  isValidZone,
  localDate,
  localDateRangeToInstants,
  parseLocalDate,
  startOfMonth,
  wallTimeToInstant,
  weekStart,
  weekdayOf,
} from './time.js';
import type { LocalDate } from './time.js';

const CHICAGO = 'America/Chicago';
const HOUR_MS = 3_600_000;

// America/Chicago in 2026: CST is UTC-6, CDT is UTC-5.
// Spring forward: Sunday 2026-03-08 02:00 CST -> 03:00 CDT (08:00Z).
// Fall back: Sunday 2026-11-01 02:00 CDT -> 01:00 CST (07:00Z).
// Expected values below are worked out by hand from those offsets.

describe('localDate', () => {
  it('is the calendar date on the wall in the zone, not in UTC', () => {
    // 2026-01-15 03:00Z is still the evening of the 14th in Chicago (UTC-6).
    expect(localDate(new Date('2026-01-15T03:00:00Z'), CHICAGO)).toBe('2026-01-14');
  });

  it.each([
    ['01:59:59 CST, just before spring forward', '2026-03-08T07:59:59Z', '2026-03-08'],
    ['03:00:00 CDT, just after spring forward', '2026-03-08T08:00:00Z', '2026-03-08'],
    ['23:59:59 CDT on the spring-forward Sunday', '2026-03-09T04:59:59Z', '2026-03-08'],
    ['00:00 CDT on the Monday after spring forward', '2026-03-09T05:00:00Z', '2026-03-09'],
    ['01:59:59 CST, the second 01:xx after fall back', '2026-11-01T07:59:59Z', '2026-11-01'],
    ['02:00:00 CST, after fall back', '2026-11-01T08:00:00Z', '2026-11-01'],
    ['23:59:59 CST on the fall-back Sunday', '2026-11-02T05:59:59Z', '2026-11-01'],
    ['00:00 CST on the Monday after fall back', '2026-11-02T06:00:00Z', '2026-11-02'],
  ])('is correct in Chicago at %s', (_label, iso, expected) => {
    expect(localDate(new Date(iso), CHICAGO)).toBe(expected);
  });

  it('handles a half-hour zone (Asia/Kolkata, UTC+5:30)', () => {
    expect(localDate(new Date('2026-10-25T18:29:59Z'), 'Asia/Kolkata')).toBe('2026-10-25');
    expect(localDate(new Date('2026-10-25T18:30:00Z'), 'Asia/Kolkata')).toBe('2026-10-26');
  });
});

describe('weekStart', () => {
  it('is the instant of Monday 00:00 local of the week containing the instant', () => {
    // Thursday 2026-01-15 12:00 Chicago (UTC-6) -> Monday 2026-01-12 00:00 Chicago.
    expect(weekStart(new Date('2026-01-15T18:00:00Z'), CHICAGO)).toEqual(
      new Date('2026-01-12T06:00:00Z'),
    );
  });

  it.each([
    // The spring-forward week runs Mon 2026-03-02 00:00 CST (06:00Z) to Mon 2026-03-09 00:00 CDT (05:00Z).
    ['the Sunday before Monday 00:00 CST', '2026-03-02T05:59:59Z', '2026-02-23T06:00:00Z'],
    ['Monday 00:00 CST itself', '2026-03-02T06:00:00Z', '2026-03-02T06:00:00Z'],
    ['01:59:59 CST, just before spring forward', '2026-03-08T07:59:59Z', '2026-03-02T06:00:00Z'],
    ['03:00:00 CDT, just after spring forward', '2026-03-08T08:00:00Z', '2026-03-02T06:00:00Z'],
    ['23:59:59 CDT, just before the next Monday', '2026-03-09T04:59:59Z', '2026-03-02T06:00:00Z'],
    ['Monday 00:00 CDT itself', '2026-03-09T05:00:00Z', '2026-03-09T05:00:00Z'],
    // The fall-back week runs Mon 2026-10-26 00:00 CDT (05:00Z) to Mon 2026-11-02 00:00 CST (06:00Z).
    ['the Sunday before Monday 00:00 CDT', '2026-10-26T04:59:59Z', '2026-10-19T05:00:00Z'],
    ['Monday 00:00 CDT itself', '2026-10-26T05:00:00Z', '2026-10-26T05:00:00Z'],
    ['01:59:59 CDT, the first 01:xx', '2026-11-01T06:59:59Z', '2026-10-26T05:00:00Z'],
    ['01:00:00 CST, the repeated hour', '2026-11-01T07:00:00Z', '2026-10-26T05:00:00Z'],
    ['02:00:00 CST, after fall back', '2026-11-01T08:00:00Z', '2026-10-26T05:00:00Z'],
    ['23:59:59 CST, just before the next Monday', '2026-11-02T05:59:59Z', '2026-10-26T05:00:00Z'],
    ['Monday 00:00 CST itself', '2026-11-02T06:00:00Z', '2026-11-02T06:00:00Z'],
  ])('is correct in Chicago at %s', (_label, iso, expected) => {
    expect(weekStart(new Date(iso), CHICAGO)).toEqual(new Date(expected));
  });

  it('makes a week containing a DST transition 167 or 169 hours long', () => {
    const hoursOfWeekContaining = (iso: string): number => {
      const start = weekStart(new Date(iso), CHICAGO);
      // Any instant 8 days on lies in the following week.
      const next = weekStart(new Date(new Date(iso).getTime() + 8 * 24 * HOUR_MS), CHICAGO);
      return (next.getTime() - start.getTime()) / HOUR_MS;
    };
    expect(hoursOfWeekContaining('2026-03-05T18:00:00Z')).toBe(167);
    expect(hoursOfWeekContaining('2026-10-29T18:00:00Z')).toBe(169);
    expect(hoursOfWeekContaining('2026-01-15T18:00:00Z')).toBe(168);
  });

  it('handles a half-hour zone (Asia/Kolkata, UTC+5:30)', () => {
    // Sunday 2026-10-25 23:59:59 IST and Monday 2026-10-26 00:00 IST.
    expect(weekStart(new Date('2026-10-25T18:29:59Z'), 'Asia/Kolkata')).toEqual(
      new Date('2026-10-18T18:30:00Z'),
    );
    expect(weekStart(new Date('2026-10-25T18:30:00Z'), 'Asia/Kolkata')).toEqual(
      new Date('2026-10-25T18:30:00Z'),
    );
  });

  it('starts at the first instant of Monday when Monday 00:00 does not exist', () => {
    // Asia/Tehran sprang forward on Monday 2021-03-22 from 00:00 (+03:30)
    // straight to 01:00 (+04:30), i.e. at 2021-03-21T20:30Z.
    const start = weekStart(new Date('2021-03-24T08:30:00Z'), 'Asia/Tehran');
    expect(start).toEqual(new Date('2021-03-21T20:30:00Z'));
    expect(localDate(start, 'Asia/Tehran')).toBe('2021-03-22');
  });
});

describe('malformed input', () => {
  const fns = { localDate, weekStart };
  const anInstant = new Date('2026-01-15T18:00:00Z');

  describe.each(Object.entries(fns))('%s', (_name, fn) => {
    it('throws InvalidInstantError for an invalid Date', () => {
      expect(() => fn(new Date('not a date'), CHICAGO)).toThrow(InvalidInstantError);
    });

    it.each([
      ['an unknown zone', 'Mars/Base'],
      ['an empty string', ''],
      ['surrounding whitespace', ' America/Chicago'],
      // A fixed offset is a real Temporal zone but has no DST rules, so a
      // config typo like this would silently shift every summer week.
      ['a UTC offset', '-06:00'],
      ['an ISO date-time string', '2026-01-01T00:00[America/Chicago]'],
    ])('throws InvalidTimeZoneError for %s', (_label, zone) => {
      expect(() => fn(anInstant, zone)).toThrow(InvalidTimeZoneError);
    });

    it('names the offending zone in the error', () => {
      expect(() => fn(anInstant, 'Mars/Base')).toThrow(
        expect.objectContaining({ zone: 'Mars/Base' }),
      );
    });

    it.each(['UTC', 'america/chicago', 'Asia/Calcutta'])('accepts the IANA name %s', (zone) => {
      expect(() => fn(anInstant, zone)).not.toThrow();
    });
  });

  describe('isValidZone', () => {
    it.each(['Mars/Base', '', ' America/Chicago', '-06:00', '2026-01-01T00:00[America/Chicago]'])(
      'rejects %j, as localDate does',
      (zone) => {
        expect(isValidZone(zone)).toBe(false);
      },
    );

    it.each(['UTC', 'america/chicago', 'Asia/Calcutta', CHICAGO])('accepts %s', (zone) => {
      expect(isValidZone(zone)).toBe(true);
    });
  });

  it('errors are RangeErrors, so generic handlers still classify them', () => {
    expect(() => localDate(new Date(NaN), CHICAGO)).toThrow(RangeError);
    expect(() => localDate(anInstant, 'Mars/Base')).toThrow(RangeError);
  });
});

describe('local date arithmetic', () => {
  it('parses only the YYYY-MM-DD shape with a real date', () => {
    expect(parseLocalDate('2026-02-28')).toBe('2026-02-28');
    for (const bad of ['2026-02-30', '2026-13-01', '2026-2-3', '20260203', '2026-02-03T10:00', '']) {
      expect(parseLocalDate(bad)).toBeUndefined();
    }
  });

  it('adds whole months, clamping the day to the shorter month', () => {
    expect(addMonths('2026-01-31' as LocalDate, 1)).toBe('2026-02-28');
    expect(addMonths('2026-01-15' as LocalDate, -3)).toBe('2025-10-15');
    expect(addMonths('2026-10-23' as LocalDate, 12)).toBe('2027-10-23');
  });

  it('adds days across month and year ends', () => {
    expect(addDays('2026-12-31' as LocalDate, 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01' as LocalDate, -1)).toBe('2026-02-28');
  });

  it('finds the first and last day of a month, including leap February', () => {
    expect(startOfMonth('2026-10-23' as LocalDate)).toBe('2026-10-01');
    expect(endOfMonth('2026-10-23' as LocalDate)).toBe('2026-10-31');
    expect(endOfMonth('2028-02-10' as LocalDate)).toBe('2028-02-29');
  });

  it('counts the days from one date to another, negative when backwards', () => {
    expect(daysBetween('2026-01-01' as LocalDate, '2026-04-03' as LocalDate)).toBe(92);
    expect(daysBetween('2026-04-03' as LocalDate, '2026-01-01' as LocalDate)).toBe(-92);
    expect(daysBetween('2026-01-01' as LocalDate, '2026-01-01' as LocalDate)).toBe(0);
  });

  it('names the ISO weekday of a date, Monday 1 through Sunday 7', () => {
    // 2026-10-19 is a Monday; 2026-03-08 and 2026-11-01 are the DST Sundays.
    expect(weekdayOf('2026-10-19' as LocalDate)).toBe(1);
    expect(weekdayOf('2026-10-23' as LocalDate)).toBe(5);
    expect(weekdayOf('2026-03-08' as LocalDate)).toBe(7);
    expect(weekdayOf('2026-11-01' as LocalDate)).toBe(7);
    expect(weekdayOf('2028-02-29' as LocalDate)).toBe(2);
  });
});

describe('wallTimeToInstant', () => {
  it('turns a wall time in the zone into the instant, with the zone offset of that date', () => {
    // 09:00 CST (UTC-6) in January; 09:00 CDT (UTC-5) in July.
    expect(wallTimeToInstant(2026, 1, 15, 9, 0, 0, CHICAGO)).toEqual(new Date('2026-01-15T15:00:00Z'));
    expect(wallTimeToInstant(2026, 7, 15, 9, 0, 0, CHICAGO)).toEqual(new Date('2026-07-15T14:00:00Z'));
  });

  it('moves a wall time in the spring-forward gap to the later side', () => {
    // 02:30 on 2026-03-08 does not exist in Chicago; it reads as 03:30 CDT.
    expect(wallTimeToInstant(2026, 3, 8, 2, 30, 0, CHICAGO)).toEqual(new Date('2026-03-08T08:30:00Z'));
  });

  it('takes the first of the two fall-back wall times', () => {
    // 01:30 on 2026-11-01 happens twice; the CDT one (06:30Z) comes first.
    expect(wallTimeToInstant(2026, 11, 1, 1, 30, 0, CHICAGO)).toEqual(new Date('2026-11-01T06:30:00Z'));
  });

  it('rejects a bad zone the way localDate does', () => {
    expect(() => wallTimeToInstant(2026, 1, 1, 0, 0, 0, 'Mars/Base')).toThrow(InvalidTimeZoneError);
  });
});

describe('localDateRangeToInstants', () => {
  it('spans from the first instant of `from` to the first instant of the day after `to`', () => {
    expect(
      localDateRangeToInstants('2026-01-14' as LocalDate, '2026-01-15' as LocalDate, CHICAGO),
    ).toEqual({ start: new Date('2026-01-14T06:00:00Z'), end: new Date('2026-01-16T06:00:00Z') });
  });

  it('is 23 hours long on the spring-forward day', () => {
    const { start, end } = localDateRangeToInstants(
      '2026-03-08' as LocalDate,
      '2026-03-08' as LocalDate,
      CHICAGO,
    );
    expect(end.getTime() - start.getTime()).toBe(23 * HOUR_MS);
  });
});
