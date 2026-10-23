// Waiting, overdue, due today and the pool (GLOSSARY), computed from a
// chore's rule and its completion log alone: nothing is stored per due date
// and no nightly job runs. "Today" is the zone's local date of `now`.
import { addDays, daysBetween, localDate } from '../../core/time.js';
import type { LocalDate } from '../../core/time.js';
import type { Completion } from './completion.js';
import { nextDueDate } from './dueDates.js';
import type { RecurrenceRule } from './rule.js';

/** Where a chore that is not archived stands today. */
export type ChoreStatus =
  /** Waiting: its earliest unsatisfied due date is before today. */
  | { kind: 'overdue'; since: LocalDate; daysLate: number }
  /** Waiting: its earliest unsatisfied due date is today. */
  | { kind: 'due-today' }
  /** A scheduled chore that is not waiting, with its next due date after today. */
  | { kind: 'upcoming'; nextDue: LocalDate }
  /** An anytime chore (rule whenever): claimable once per local day. */
  | { kind: 'anytime'; claimedToday: boolean };

export type WaitingStatus = Extract<ChoreStatus, { kind: 'overdue' | 'due-today' }>;

/**
 * The status of `chore` at `now` in `zone`. `completions` must include the
 * chore's latest completion that was not voided (voided ones are skipped,
 * so passing them too is harmless). One claim satisfies every due date up
 * to its own local date.
 */
export function choreStatus(
  chore: { rule: RecurrenceRule; startDate: LocalDate },
  completions: readonly Pick<Completion, 'completedAt' | 'voided'>[],
  now: Date,
  zone: string,
): ChoreStatus {
  const today = localDate(now, zone);
  let last: Date | undefined;
  for (const completion of completions) {
    if (completion.voided !== null) continue;
    if (last === undefined || completion.completedAt > last) last = completion.completedAt;
  }
  const lastDate = last === undefined ? undefined : localDate(last, zone);

  if (chore.rule.kind === 'whenever') return { kind: 'anytime', claimedToday: lastDate === today };

  const from = lastDate === undefined ? chore.startDate : addDays(lastDate, 1);
  const earliest = nextDueDate(chore.rule, chore.startDate, from);
  if (earliest !== undefined && earliest < today) {
    return { kind: 'overdue', since: earliest, daysLate: daysBetween(earliest, today) };
  }
  if (earliest === today) return { kind: 'due-today' };
  // Every scheduled rule has a due date after any date.
  const nextDue = nextDueDate(chore.rule, chore.startDate, addDays(today, 1)) as LocalDate;
  return { kind: 'upcoming', nextDue };
}

export function isWaiting(status: ChoreStatus): status is WaitingStatus {
  return status.kind === 'overdue' || status.kind === 'due-today';
}

/** Whether a claim now is allowed: waiting, or an anytime chore not yet claimed today. */
export function isClaimable(status: ChoreStatus): boolean {
  return isWaiting(status) || (status.kind === 'anytime' && !status.claimedToday);
}

/**
 * The pool's order: overdue first, latest first, then due today; within
 * each, points descending, then name ignoring case. For Array.prototype.sort.
 */
export function comparePool(
  a: { name: string; points: number; status: WaitingStatus },
  b: { name: string; points: number; status: WaitingStatus },
): number {
  return lateness(b.status) - lateness(a.status) || b.points - a.points || compareNames(a.name, b.name);
}

/** -1 for due today, so it sorts after any overdue (0 days late is not overdue). */
function lateness(status: WaitingStatus): number {
  return status.kind === 'overdue' ? status.daysLate : -1;
}

export function compareNames(a: string, b: string): number {
  return a.localeCompare(b, 'en', { sensitivity: 'base' });
}
