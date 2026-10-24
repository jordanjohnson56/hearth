// Standings: points per person over a window of the completion log. The
// leaderboard is this over the current week; a season (M3) is the same
// function over its own window. Voided completions earn nothing.
import { addDays, firstInstantOf, localDate, weekStart } from '../../core/time.js';
import type { Completion } from './completion.js';
import { compareNames } from './pool.js';

/** The half-open instant range [start, end). */
export interface TimeWindow {
  start: Date;
  end: Date;
}

export interface Standing {
  /** 1 for the most points; equal points share a rank and skip the ranks the tie used (1, 1, 3). */
  rank: number;
  personId: number;
  points: number;
}

/**
 * The week containing `now` in `zone`: Monday 00:00 local to the next
 * Monday 00:00 local, so a DST week is 167 or 169 hours long.
 */
export function weekWindow(now: Date, zone: string): TimeWindow {
  const start = weekStart(now, zone);
  return { start, end: firstInstantOf(addDays(localDate(start, zone), 7), zone) };
}

/**
 * Every person in `people` with the points of their completions that were
 * not voided and whose instant is in `window`, those on zero included.
 * Ordered by points descending, then name ignoring case.
 */
export function standings(
  people: readonly { id: number; displayName: string }[],
  completions: readonly Pick<Completion, 'personId' | 'completedAt' | 'pointsAwarded' | 'voided'>[],
  window: TimeWindow,
): Standing[] {
  const points = new Map(people.map((person) => [person.id, 0]));
  for (const completion of completions) {
    if (completion.voided !== null) continue;
    if (completion.completedAt < window.start || completion.completedAt >= window.end) continue;
    const sum = points.get(completion.personId);
    if (sum !== undefined) points.set(completion.personId, sum + completion.pointsAwarded);
  }
  const ordered = [...people].sort(
    (a, b) => (points.get(b.id) ?? 0) - (points.get(a.id) ?? 0) || compareNames(a.displayName, b.displayName),
  );
  let rank = 0;
  let previous: number | undefined;
  return ordered.map((person, index) => {
    const total = points.get(person.id) ?? 0;
    if (total !== previous) rank = index + 1;
    previous = total;
    return { rank, personId: person.id, points: total };
  });
}
