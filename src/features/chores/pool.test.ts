import { describe, expect, it } from 'vitest';
import type { LocalDate } from '../../core/time.js';
import type { CompletionVoid } from './completion.js';
import { choreStatus, comparePool, isClaimable } from './pool.js';
import type { ChoreStatus, WaitingStatus } from './pool.js';
import type { RecurrenceRule } from './rule.js';

const d = (text: string) => text as LocalDate;
const CHICAGO = 'America/Chicago';

// Friday 2026-10-23 12:00 in Chicago (CDT, UTC-5). Expected dates are
// worked out by hand from the 2026 wall calendar.
const NOW = new Date('2026-10-23T17:00:00Z');
const UNDONE: CompletionVoid = { voidedAt: new Date('2026-10-23T17:00:10Z'), reason: 'undo' };

const chore = (rule: RecurrenceRule, startDate: string) => ({ rule, startDate: d(startDate) });
const daily = (startDate: string) => chore({ kind: 'daily' }, startDate);
const done = (iso: string, voided: CompletionVoid | null = null) => ({ completedAt: new Date(iso), voided });

describe('choreStatus', () => {
  it('is due today from its start date when it has no completions', () => {
    expect(choreStatus(daily('2026-10-23'), [], NOW, CHICAGO)).toEqual({ kind: 'due-today' });
  });

  it('is overdue since its start date when that has passed with no completions', () => {
    expect(choreStatus(daily('2026-10-20'), [], NOW, CHICAGO)).toEqual({
      kind: 'overdue',
      since: '2026-10-20',
      daysLate: 3,
    });
  });

  it('is due today, not late, when a daily chore was done yesterday', () => {
    // Thursday 2026-10-22 08:00 Chicago.
    expect(choreStatus(daily('2026-10-01'), [done('2026-10-22T13:00:00Z')], NOW, CHICAGO)).toEqual({
      kind: 'due-today',
    });
  });

  it("is 1 day late today when a daily chore missed yesterday's due date", () => {
    // Wednesday 2026-10-21 20:00 Chicago: Thursday's due date went unclaimed.
    expect(choreStatus(daily('2026-10-01'), [done('2026-10-22T01:00:00Z')], NOW, CHICAGO)).toEqual({
      kind: 'overdue',
      since: '2026-10-22',
      daysLate: 1,
    });
  });

  it('is upcoming with tomorrow as its next due date once done today', () => {
    // Friday 2026-10-23 07:00 Chicago.
    expect(choreStatus(daily('2026-10-01'), [done('2026-10-23T12:00:00Z')], NOW, CHICAGO)).toEqual({
      kind: 'upcoming',
      nextDue: '2026-10-24',
    });
  });

  it('ignores a voided completion', () => {
    const status = choreStatus(daily('2026-10-01'), [done('2026-10-23T12:00:00Z', UNDONE)], NOW, CHICAGO);

    expect(status).toEqual({ kind: 'overdue', since: '2026-10-01', daysLate: 22 });
  });

  it('counts from the latest completion that was not voided', () => {
    const status = choreStatus(
      daily('2026-10-01'),
      [done('2026-10-23T12:00:00Z', UNDONE), done('2026-10-22T13:00:00Z'), done('2026-10-20T13:00:00Z')],
      NOW,
      CHICAGO,
    );

    expect(status).toEqual({ kind: 'due-today' });
  });

  it('reads the completion date on the wall in the zone, not in UTC', () => {
    // 2026-10-23T04:30Z is still Thursday 23:30 in Chicago, so today is unsatisfied.
    expect(choreStatus(daily('2026-10-01'), [done('2026-10-23T04:30:00Z')], NOW, CHICAGO)).toEqual({
      kind: 'due-today',
    });
  });

  it('is one overdue item since the earliest missed date however many were missed', () => {
    // Every 2 days from Thursday 2026-10-01: Oct 15, 17, 19, 21, 23 since a claim on the 14th.
    const status = choreStatus(
      chore({ kind: 'every', unit: 'days', interval: 2 }, '2026-10-01'),
      [done('2026-10-14T15:00:00Z')],
      NOW,
      CHICAGO,
    );

    expect(status).toEqual({ kind: 'overdue', since: '2026-10-15', daysLate: 8 });
  });

  it('is upcoming with its first due date when the start date is in the future', () => {
    expect(choreStatus(chore({ kind: 'weekly', days: ['tue'] }, '2026-11-01'), [], NOW, CHICAGO)).toEqual({
      kind: 'upcoming',
      nextDue: '2026-11-03',
    });
  });

  it('is upcoming between due dates of a weekly chore', () => {
    // Vacuum on Wednesdays and Saturdays, done Wednesday the 21st; next is Saturday the 24th.
    const status = choreStatus(
      chore({ kind: 'weekly', days: ['wed', 'sat'] }, '2026-10-01'),
      [done('2026-10-21T15:00:00Z')],
      NOW,
      CHICAGO,
    );

    expect(status).toEqual({ kind: 'upcoming', nextDue: '2026-10-24' });
  });

  it('crosses the fall-back night without losing or gaining a day', () => {
    // Sunday 2026-11-01 is 25 hours long in Chicago. Done Saturday 23:00 CDT;
    // on Monday 2026-11-02 12:00 CST, Sunday's due date was missed.
    const status = choreStatus(
      daily('2026-10-01'),
      [done('2026-11-01T04:00:00Z')],
      new Date('2026-11-02T18:00:00Z'),
      CHICAGO,
    );

    expect(status).toEqual({ kind: 'overdue', since: '2026-11-01', daysLate: 1 });
  });

  describe('an anytime chore', () => {
    const washTheCar = chore({ kind: 'whenever' }, '2026-10-01');

    it('is never waiting, and unclaimed today with no completions', () => {
      expect(choreStatus(washTheCar, [], NOW, CHICAGO)).toEqual({ kind: 'anytime', claimedToday: false });
    });

    it('is claimed today after a completion today', () => {
      expect(choreStatus(washTheCar, [done('2026-10-23T13:00:00Z')], NOW, CHICAGO)).toEqual({
        kind: 'anytime',
        claimedToday: true,
      });
    });

    it('is unclaimed today after a completion yesterday or a voided one today', () => {
      const status = choreStatus(
        washTheCar,
        [done('2026-10-23T13:00:00Z', UNDONE), done('2026-10-22T13:00:00Z')],
        NOW,
        CHICAGO,
      );

      expect(status).toEqual({ kind: 'anytime', claimedToday: false });
    });

    it('is not started, so not claimable, before its start date, and anytime from it', () => {
      const summerChore = chore({ kind: 'whenever' }, '2026-10-24');
      // Saturday 2026-10-24 00:00 CDT.
      const saturday = new Date('2026-10-24T05:00:00Z');

      expect(choreStatus(summerChore, [], NOW, CHICAGO)).toEqual({ kind: 'not-started' });
      expect(choreStatus(summerChore, [], saturday, CHICAGO)).toEqual({ kind: 'anytime', claimedToday: false });
    });
  });
});

describe('isClaimable', () => {
  it.each<[ChoreStatus, boolean]>([
    [{ kind: 'due-today' }, true],
    [{ kind: 'overdue', since: d('2026-10-20'), daysLate: 3 }, true],
    [{ kind: 'upcoming', nextDue: d('2026-10-24') }, false],
    [{ kind: 'anytime', claimedToday: false }, true],
    [{ kind: 'anytime', claimedToday: true }, false],
    [{ kind: 'not-started' }, false],
  ])('%j is %s', (status, expected) => {
    expect(isClaimable(status)).toBe(expected);
  });
});

describe('comparePool', () => {
  const entry = (name: string, points: number, status: WaitingStatus) => ({ name, points, status });
  const today: WaitingStatus = { kind: 'due-today' };
  const late = (daysLate: number): WaitingStatus => ({ kind: 'overdue', since: d('2026-10-01'), daysLate });

  it('puts overdue first, latest first, then due today, each by points then name', () => {
    const pool = [
      entry('Water the plants', 3, today),
      entry('feed the dog', 2, late(1)),
      entry('Empty the bins', 5, today),
      entry('Clean the hob', 3, today),
      entry('Wipe the table', 1, late(3)),
      entry('Fold laundry', 4, late(1)),
    ];

    expect(pool.sort(comparePool).map((e) => e.name)).toEqual([
      'Wipe the table',
      'Fold laundry',
      'feed the dog',
      'Empty the bins',
      'Clean the hob',
      'Water the plants',
    ]);
  });
});
