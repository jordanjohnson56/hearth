import { afterEach, describe, expect, it } from 'vitest';
import type { LocalDate } from '../../core/time.js';
import { dueDates, nextDueDate } from './dueDates.js';
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

describe('nextDueDate', () => {
  it('is the first due date on or after the given date', () => {
    // Every 3 days from Thursday 2026-10-01: Oct 1, 4, 7, …, 22, 25.
    const rule: RecurrenceRule = { kind: 'every', unit: 'days', interval: 3 };
    expect(nextDueDate(rule, d('2026-10-01'), d('2026-10-23'))).toBe('2026-10-25');
    expect(nextDueDate(rule, d('2026-10-01'), d('2026-10-22'))).toBe('2026-10-22');
  });

  it('is the start date when the given date is before it', () => {
    expect(nextDueDate({ kind: 'daily' }, d('2026-11-02'), d('2026-10-23'))).toBe('2026-11-02');
  });

  it('keeps an every-2-weeks rule on its start weekday', () => {
    // Monday 2026-10-05, then 19th, then Monday 2026-11-02 across the fall-back Sunday.
    const rule: RecurrenceRule = { kind: 'every', unit: 'weeks', interval: 2 };
    expect(nextDueDate(rule, d('2026-10-05'), d('2026-10-20'))).toBe('2026-11-02');
  });

  it('finds the next chosen weekday of a weekly rule', () => {
    // Friday 2026-10-23: the next Wednesday or Saturday is Saturday the 24th.
    expect(nextDueDate({ kind: 'weekly', days: ['wed', 'sat'] }, d('2026-01-01'), d('2026-10-23'))).toBe(
      '2026-10-24',
    );
  });

  it('clamps a monthly 31st to the last day of a short month', () => {
    expect(nextDueDate({ kind: 'monthly', day: 31 }, d('2026-01-01'), d('2026-02-01'))).toBe('2026-02-28');
    expect(nextDueDate({ kind: 'monthly', day: 31 }, d('2026-01-01'), d('2026-03-01'))).toBe('2026-03-31');
  });

  it('is undefined for a whenever rule', () => {
    expect(nextDueDate({ kind: 'whenever' }, d('2026-01-01'), d('2026-10-23'))).toBeUndefined();
  });

  it.each<[string, RecurrenceRule]>([
    ['daily', { kind: 'daily' }],
    ['weekly', { kind: 'weekly', days: ['tue', 'sun'] }],
    ['every 5 days', { kind: 'every', unit: 'days', interval: 5 }],
    ['every 3 weeks', { kind: 'every', unit: 'weeks', interval: 3 }],
    ['monthly on the 30th', { kind: 'monthly', day: 30 }],
  ])('agrees with dueDates for a %s rule on every day of a year', (_label, rule) => {
    const start = d('2026-01-07');
    const all = dueDates(rule, start, d('2027-03-31'));
    for (const from of dueDates({ kind: 'daily' }, d('2026-01-01'), d('2026-12-31'))) {
      expect(nextDueDate(rule, start, from)).toBe(all.find((date) => date >= from));
    }
  });
});
