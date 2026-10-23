import { describe, expect, it } from 'vitest';
import { InvalidInstantError, InvalidTimeZoneError, localDate, weekStart } from './time.js';

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

  it('errors are RangeErrors, so generic handlers still classify them', () => {
    expect(() => localDate(new Date(NaN), CHICAGO)).toThrow(RangeError);
    expect(() => localDate(anInstant, 'Mars/Base')).toThrow(RangeError);
  });
});
