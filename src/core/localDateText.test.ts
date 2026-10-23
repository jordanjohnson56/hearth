import { describe, expect, it } from 'vitest';
import { addDays, atUtcMidnight, datesSpanning, formatLocalDate, localDateOf, partsOf } from './localDateText.js';
import { localDate } from './time.js';

describe('localDateOf', () => {
  it('is the wall-calendar date in the zone, not the UTC date', () => {
    // 2026-10-24 03:30Z is still the evening of Oct 23 in Chicago (CDT).
    const instant = new Date('2026-10-24T03:30:00Z');
    expect(localDateOf(instant, 'America/Chicago')).toBe('2026-10-23');
    expect(localDateOf(instant, 'UTC')).toBe('2026-10-24');
    expect(localDateOf(instant, 'Asia/Tokyo')).toBe('2026-10-24');
  });

  it('agrees with the Temporal core across the 2026 Chicago DST instants and the midnights around them', () => {
    const instants = [
      // Spring forward, March 8: 01:59:59 CST, then 03:00 CDT.
      '2026-03-08T05:59:59Z',
      '2026-03-08T06:00:00Z',
      '2026-03-08T07:59:59Z',
      '2026-03-08T08:00:00Z',
      '2026-03-09T04:59:59Z',
      '2026-03-09T05:00:00Z',
      // Fall back, November 1: 01:30 CDT and 01:30 CST both happen.
      '2026-11-01T04:59:59Z',
      '2026-11-01T05:00:00Z',
      '2026-11-01T06:30:00Z',
      '2026-11-01T07:30:00Z',
      '2026-11-02T05:59:59Z',
      '2026-11-02T06:00:00Z',
    ].map((iso) => new Date(iso));

    for (const instant of instants) {
      expect(localDateOf(instant, 'America/Chicago')).toBe(localDate(instant, 'America/Chicago'));
    }
    // The list crosses days, so the comparison is not twelve copies of one answer.
    expect(new Set(instants.map((instant) => localDateOf(instant, 'America/Chicago'))).size).toBe(6);
  });
});

describe('partsOf and formatLocalDate', () => {
  it('split a date into numbers and join it back with zero padding', () => {
    expect(partsOf('2026-03-08')).toEqual({ year: 2026, month: 3, day: 8 });
    expect(formatLocalDate(2026, 3, 8)).toBe('2026-03-08');
    expect(formatLocalDate(999, 12, 1)).toBe('0999-12-01');
  });

  it('refuse text that is not YYYY-MM-DD', () => {
    expect(() => partsOf('2026-3-8')).toThrow(RangeError);
    expect(() => partsOf('20260308')).toThrow(RangeError);
    expect(() => partsOf('')).toThrow(RangeError);
  });
});

describe('atUtcMidnight', () => {
  it('names the same calendar day when formatted in UTC', () => {
    const day = atUtcMidnight('2026-03-08');

    expect(day.toISOString()).toBe('2026-03-08T00:00:00.000Z');
    expect(new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long' }).format(day)).toBe('Sunday');
  });
});

describe('addDays', () => {
  it('crosses month and year ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
  });

  it('knows February in a leap year', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
  });

  it('adds zero and many days', () => {
    expect(addDays('2026-10-23', 0)).toBe('2026-10-23');
    expect(addDays('2026-10-23', 365)).toBe('2027-10-23');
  });
});

describe('datesSpanning', () => {
  it('lists every date from first through last, both included', () => {
    expect(datesSpanning('2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
    expect(datesSpanning('2026-10-23', '2026-10-23')).toEqual(['2026-10-23']);
  });

  it('is empty when last is before first', () => {
    expect(datesSpanning('2026-10-24', '2026-10-23')).toEqual([]);
  });
});
