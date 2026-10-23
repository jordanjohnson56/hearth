import { afterEach, describe, expect, it } from 'vitest';
import type { LocalDate } from '../../core/time.js';
import { dueDates } from './dueDates.js';
import type { RecurrenceRule } from './rule.js';

const d = (text: string) => text as LocalDate;

// Expected dates are worked out by hand from a 2026 wall calendar:
// 2026-01-01 is a Thursday, 2026-10-19 a Monday. Chicago's DST Sundays
// are 2026-03-08 (spring forward) and 2026-11-01 (fall back).

describe('dueDates', () => {
  it('gives every date for a daily rule, the start and the through-date included', () => {
    expect(dueDates({ kind: 'daily' }, d('2026-10-21'), d('2026-10-23'))).toEqual([
      '2026-10-21',
      '2026-10-22',
      '2026-10-23',
    ]);
  });

  it('gives the start date alone when it is the through-date', () => {
    expect(dueDates({ kind: 'daily' }, d('2026-10-23'), d('2026-10-23'))).toEqual(['2026-10-23']);
  });

  describe('weekly', () => {
    it('gives each chosen weekday across a whole year', () => {
      const dates = dueDates({ kind: 'weekly', days: ['mon', 'thu'] }, d('2026-01-01'), d('2026-12-31'));

      // 2026 has 365 days: 52 weeks plus one Thursday, so 53 Thursdays and 52 Mondays.
      expect(dates).toHaveLength(105);
      expect(dates.slice(0, 4)).toEqual(['2026-01-01', '2026-01-05', '2026-01-08', '2026-01-12']);
      expect(dates.slice(-3)).toEqual(['2026-12-24', '2026-12-28', '2026-12-31']);
      // The Mondays after both DST Sundays.
      expect(dates).toContain('2026-03-09');
      expect(dates).toContain('2026-11-02');
      expect(dates).not.toContain('2026-03-08');
    });

    it('starts at the first chosen weekday on or after the start date', () => {
      expect(dueDates({ kind: 'weekly', days: ['sat'] }, d('2026-10-19'), d('2026-11-01'))).toEqual([
        '2026-10-24',
        '2026-10-31',
      ]);
    });
  });

  describe('every', () => {
    it('keeps the start date’s weekday for every 2 weeks, across the fall-back Sunday', () => {
      // 2026-10-07 is a Wednesday.
      expect(
        dueDates({ kind: 'every', unit: 'weeks', interval: 2 }, d('2026-10-07'), d('2026-12-01')),
      ).toEqual(['2026-10-07', '2026-10-21', '2026-11-04', '2026-11-18']);
    });

    it('counts every 3 days from the start date', () => {
      expect(dueDates({ kind: 'every', unit: 'days', interval: 3 }, d('2026-03-02'), d('2026-03-14'))).toEqual([
        '2026-03-02',
        '2026-03-05',
        '2026-03-08',
        '2026-03-11',
        '2026-03-14',
      ]);
    });

    describe('whatever the host zone', () => {
      const hostZone = process.env['TZ'];
      afterEach(() => {
        if (hostZone === undefined) delete process.env['TZ'];
        else process.env['TZ'] = hostZone;
      });

      // Every 2 days across a DST Sunday and the Monday-midnight week boundary after it.
      const cases: [string, LocalDate, LocalDate, string[]][] = [
        ['spring forward', d('2026-03-07'), d('2026-03-11'), ['2026-03-07', '2026-03-09', '2026-03-11']],
        ['fall back', d('2026-10-31'), d('2026-11-04'), ['2026-10-31', '2026-11-02', '2026-11-04']],
      ];

      it.each(cases)('gives the same dates in UTC as in Chicago across %s', (_label, start, through, expected) => {
        const rule: RecurrenceRule = { kind: 'every', unit: 'days', interval: 2 };

        process.env['TZ'] = 'UTC';
        const inUtc = dueDates(rule, start, through);
        process.env['TZ'] = 'America/Chicago';
        // The switch took: the host now sees Chicago's offset.
        expect(new Date('2026-01-15T12:00:00Z').getTimezoneOffset()).toBe(360);
        const inChicago = dueDates(rule, start, through);

        expect(inUtc).toEqual(expected);
        expect(inChicago).toEqual(expected);
      });
    });
  });

  describe('monthly', () => {
    it('clamps day 31 to the last day of February and April', () => {
      expect(dueDates({ kind: 'monthly', day: 31 }, d('2026-01-15'), d('2026-06-30'))).toEqual([
        '2026-01-31',
        '2026-02-28',
        '2026-03-31',
        '2026-04-30',
        '2026-05-31',
        '2026-06-30',
      ]);
    });

    it('clamps to the 29th in a leap-year February', () => {
      expect(dueDates({ kind: 'monthly', day: 30 }, d('2028-02-01'), d('2028-03-31'))).toEqual([
        '2028-02-29',
        '2028-03-30',
      ]);
    });

    it('skips the start month when its day has already passed', () => {
      expect(dueDates({ kind: 'monthly', day: 15 }, d('2026-01-20'), d('2026-03-14'))).toEqual(['2026-02-15']);
    });
  });

  it('gives nothing for a whenever rule', () => {
    expect(dueDates({ kind: 'whenever' }, d('2026-01-01'), d('2026-12-31'))).toEqual([]);
  });

  it.each<[string, RecurrenceRule]>([
    ['daily', { kind: 'daily' }],
    ['weekly', { kind: 'weekly', days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] }],
    ['every', { kind: 'every', unit: 'days', interval: 2 }],
    ['monthly', { kind: 'monthly', day: 1 }],
  ])('gives nothing for a %s rule whose start date is after the through-date', (_label, rule) => {
    expect(dueDates(rule, d('2026-11-01'), d('2026-10-31'))).toEqual([]);
  });
});
