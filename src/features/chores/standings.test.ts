import { describe, expect, it } from 'vitest';
import type { CompletionVoid } from './completion.js';
import { standings, weekWindow } from './standings.js';

const CHICAGO = 'America/Chicago';
const HOUR_MS = 3_600_000;

// America/Chicago in 2026: CDT is UTC-5 until Sunday 2026-11-01 07:00Z,
// CST (UTC-6) after; spring forward was Sunday 2026-03-08 08:00Z. Expected
// values are worked out by hand from those offsets.

const ADA = { id: 1, displayName: 'Ada' };
const LINUS = { id: 2, displayName: 'Linus' };
const MARIE = { id: 3, displayName: 'Marie' };
const GRACE = { id: 4, displayName: 'Grace' };
const FAMILY = [ADA, LINUS, MARIE, GRACE];

const CORRECTED: CompletionVoid = { voidedAt: new Date('2026-10-23T20:00:00Z'), reason: 'correction' };

const done = (personId: number, pointsAwarded: number, iso: string, voided: CompletionVoid | null = null) => ({
  personId,
  pointsAwarded,
  completedAt: new Date(iso),
  voided,
});

/** The week of Monday 2026-10-19 in Chicago: 05:00Z to 05:00Z, 168 hours. */
const WEEK = weekWindow(new Date('2026-10-23T17:00:00Z'), CHICAGO);

describe('weekWindow', () => {
  it('runs from Monday 00:00 local to the next Monday 00:00 local', () => {
    expect(WEEK).toEqual({ start: new Date('2026-10-19T05:00:00Z'), end: new Date('2026-10-26T05:00:00Z') });
  });

  it.each([
    ['the spring-forward week', '2026-03-05T18:00:00Z', '2026-03-02T06:00:00Z', 167],
    ['the fall-back week', '2026-10-29T18:00:00Z', '2026-10-26T05:00:00Z', 169],
  ])('is %s long as the wall clock says', (_label, iso, start, hours) => {
    const window = weekWindow(new Date(iso), CHICAGO);

    expect(window.start).toEqual(new Date(start));
    expect((window.end.getTime() - window.start.getTime()) / HOUR_MS).toBe(hours);
  });
});

describe('standings', () => {
  it('includes everyone, those on zero too, highest first then by name', () => {
    const result = standings(FAMILY, [done(3, 5, '2026-10-20T15:00:00Z'), done(3, 2, '2026-10-21T15:00:00Z')], WEEK);

    expect(result).toEqual([
      { rank: 1, personId: 3, points: 7 },
      { rank: 2, personId: 1, points: 0 },
      { rank: 2, personId: 4, points: 0 },
      { rank: 2, personId: 2, points: 0 },
    ]);
  });

  it('shares a rank on equal points and skips the ranks the tie used', () => {
    const result = standings(
      FAMILY,
      [
        done(2, 12, '2026-10-20T15:00:00Z'),
        done(4, 12, '2026-10-21T15:00:00Z'),
        done(1, 4, '2026-10-21T15:00:00Z'),
        done(3, 1, '2026-10-22T15:00:00Z'),
      ],
      WEEK,
    );

    expect(result).toEqual([
      { rank: 1, personId: 4, points: 12 },
      { rank: 1, personId: 2, points: 12 },
      { rank: 3, personId: 1, points: 4 },
      { rank: 4, personId: 3, points: 1 },
    ]);
  });

  it('skips a voided completion', () => {
    const result = standings(
      [ADA, LINUS],
      [done(1, 3, '2026-10-20T15:00:00Z'), done(2, 10, '2026-10-21T15:00:00Z', CORRECTED)],
      WEEK,
    );

    expect(result).toEqual([
      { rank: 1, personId: 1, points: 3 },
      { rank: 2, personId: 2, points: 0 },
    ]);
  });

  it('counts Sunday 23:59 Chicago in this week and Monday 00:00 in the next', () => {
    const sundayNight = done(1, 3, '2026-10-26T04:59:00Z');
    const mondayMidnight = done(2, 5, '2026-10-26T05:00:00Z');
    const sundayBefore = done(2, 7, '2026-10-19T04:59:59Z');

    expect(standings([ADA, LINUS], [sundayNight, mondayMidnight, sundayBefore], WEEK)).toEqual([
      { rank: 1, personId: 1, points: 3 },
      { rank: 2, personId: 2, points: 0 },
    ]);
    const next = weekWindow(new Date('2026-10-26T05:00:00Z'), CHICAGO);
    expect(standings([ADA, LINUS], [sundayNight, mondayMidnight], next)).toEqual([
      { rank: 1, personId: 2, points: 5 },
      { rank: 2, personId: 1, points: 0 },
    ]);
  });

  it.each([
    // Spring forward: Mon 2026-03-02 00:00 CST (06:00Z) to Mon 2026-03-09 00:00 CDT (05:00Z).
    ['167-hour', '2026-03-05T18:00:00Z', '2026-03-02T06:00:00Z', '2026-03-09T04:59:59Z', '2026-03-09T05:00:00Z'],
    // Fall back: Mon 2026-10-26 00:00 CDT (05:00Z) to Mon 2026-11-02 00:00 CST (06:00Z).
    ['169-hour', '2026-10-29T18:00:00Z', '2026-10-26T05:00:00Z', '2026-11-02T05:59:59Z', '2026-11-02T06:00:00Z'],
  ])('keeps both ends of the %s week right', (_label, now, first, last, after) => {
    const window = weekWindow(new Date(now), CHICAGO);
    const completions = [done(1, 1, first), done(1, 2, last), done(1, 4, after), done(1, 8, '2026-03-01T05:00:00Z')];

    expect(standings([ADA], completions, window)).toEqual([{ rank: 1, personId: 1, points: 3 }]);
  });

  it('is the same function over any window, such as a season', () => {
    const season = { start: new Date('2026-09-01T05:00:00Z'), end: new Date('2026-12-01T06:00:00Z') };

    const result = standings(
      [ADA, LINUS],
      [done(1, 3, '2026-09-10T15:00:00Z'), done(2, 2, '2026-11-15T15:00:00Z'), done(1, 6, '2026-08-31T15:00:00Z')],
      season,
    );

    expect(result).toEqual([
      { rank: 1, personId: 1, points: 3 },
      { rank: 2, personId: 2, points: 2 },
    ]);
  });
});
