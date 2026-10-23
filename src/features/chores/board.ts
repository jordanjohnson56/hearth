// The chores board service: loads through the repositories, works the pool
// and the standings out with the pure core, and records claims and undos.
// The router (feature.server.ts) maps its results to HTTP.
import type { Database } from 'better-sqlite3';
import { localDate } from '../../core/time.js';
import { getPerson, listPeople, toPersonWire } from '../../server/db/personRepository.js';
import { getChore, listChores } from './choreRepository.js';
import type { Chore } from './choreRepository.js';
import { toCompletionWire } from './completion.js';
import type { Completion } from './completion.js';
import {
  getCompletion,
  insertCompletion,
  latestCountedCompletion,
  latestCountedCompletions,
  listCompletionsSince,
  voidCompletion,
} from './completionRepository.js';
import { choreStatus, compareNames, comparePool, isClaimable } from './pool.js';
import type { ChoreStatus, WaitingStatus } from './pool.js';
import { standings, weekWindow } from './standings.js';
import type {
  AnytimeChoreWire,
  BoardChoreWire,
  BoardResponse,
  UpcomingChoreWire,
  WaitingChoreWire,
} from './types.js';

/** How long after a claim the wall may undo it without the PIN. The toast shows for 10 s. */
export const UNDO_WINDOW_MS = 15_000;

/** The board at `now` in `zone` (types.ts BoardResponse has the order of each section). */
export function readBoard(db: Database, now: Date, zone: string): BoardResponse {
  const people = listPeople(db);
  const chores = listChores(db);
  const latest = latestCountedCompletions(db);
  const week = weekWindow(now, zone);

  const waiting: { chore: Chore; status: WaitingStatus }[] = [];
  const anytime: AnytimeChoreWire[] = [];
  const upcoming: UpcomingChoreWire[] = [];
  for (const chore of chores) {
    if (chore.archivedAt !== null) continue;
    const status = statusOf(chore, latest.get(chore.id), now, zone);
    switch (status.kind) {
      case 'overdue':
      case 'due-today':
        waiting.push({ chore, status });
        break;
      case 'anytime':
        anytime.push({ ...toBoardChoreWire(chore), claimedToday: status.claimedToday });
        break;
      case 'upcoming':
        upcoming.push({ ...toBoardChoreWire(chore), nextDue: status.nextDue });
        break;
      case 'not-started':
        break;
    }
  }
  waiting.sort((a, b) => comparePool({ ...a.chore, status: a.status }, { ...b.chore, status: b.status }));
  upcoming.sort(
    (a, b) => compareText(a.nextDue, b.nextDue) || b.points - a.points || compareNames(a.name, b.name),
  );

  const names = new Map(chores.map((chore) => [chore.id, chore.name]));
  const thisWeek = listCompletionsSince(db, week.start).filter(
    (completion) => completion.voided === null && completion.completedAt < week.end,
  );

  return {
    today: localDate(now, zone),
    weekStart: week.start.getTime(),
    people: people.map(toPersonWire),
    waiting: waiting.map(({ chore, status }) => toWaitingWire(chore, status)),
    anytime,
    upcoming,
    completions: thisWeek.map((completion) => ({
      ...toCompletionWire(completion),
      choreName: names.get(completion.choreId) ?? '',
    })),
    standings: standings(people, thisWeek, week),
  };
}

export type ClaimResult =
  | { kind: 'claimed'; completion: Completion }
  | { kind: 'no-chore' }
  | { kind: 'no-person' }
  | { kind: 'archived' }
  /** A scheduled chore that is not waiting. */
  | { kind: 'not-waiting' }
  /** An anytime chore already claimed today. */
  | { kind: 'claimed-today' }
  /** An anytime chore before its start date. */
  | { kind: 'not-started' };

/** Records that `personId` did chore `choreId` at `now`, worth the chore's points now. */
export function claimChore(db: Database, choreId: number, personId: number, now: Date, zone: string): ClaimResult {
  return db.transaction((): ClaimResult => {
    const chore = getChore(db, choreId);
    if (chore === undefined) return { kind: 'no-chore' };
    if (getPerson(db, personId) === undefined) return { kind: 'no-person' };
    if (chore.archivedAt !== null) return { kind: 'archived' };
    const status = statusOf(chore, latestCountedCompletion(db, chore.id), now, zone);
    if (!isClaimable(status)) {
      if (status.kind === 'anytime') return { kind: 'claimed-today' };
      return { kind: status.kind === 'not-started' ? 'not-started' : 'not-waiting' };
    }
    const completion = insertCompletion(db, { choreId, personId, completedAt: now, pointsAwarded: chore.points });
    return { kind: 'claimed', completion };
  })();
}

export type UndoResult = { kind: 'undone' } | { kind: 'no-completion' } | { kind: 'too-late' };

/**
 * The wall's undo: voids completion `id` with reason undo when `now` is
 * within UNDO_WINDOW_MS of its instant. A completion that is already voided
 * counts as gone.
 */
export function undoCompletion(db: Database, id: number, now: Date): UndoResult {
  return db.transaction((): UndoResult => {
    const completion = getCompletion(db, id);
    if (completion === undefined || completion.voided !== null) return { kind: 'no-completion' };
    if (now.getTime() - completion.completedAt.getTime() > UNDO_WINDOW_MS) return { kind: 'too-late' };
    voidCompletion(db, id, now, 'undo');
    return { kind: 'undone' };
  })();
}

function statusOf(chore: Chore, latest: Completion | undefined, now: Date, zone: string): ChoreStatus {
  return choreStatus(chore, latest === undefined ? [] : [latest], now, zone);
}

function toBoardChoreWire(chore: Chore): BoardChoreWire {
  return { id: chore.id, name: chore.name, points: chore.points };
}

function toWaitingWire(chore: Chore, status: WaitingStatus): WaitingChoreWire {
  return status.kind === 'overdue'
    ? { ...toBoardChoreWire(chore), state: 'overdue', daysLate: status.daysLate }
    : { ...toBoardChoreWire(chore), state: 'due-today' };
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
