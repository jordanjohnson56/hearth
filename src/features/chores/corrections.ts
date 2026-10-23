// Admin corrections (GLOSSARY: correction): voiding a completion after the
// undo window, and reassigning one to someone else. Both only insert
// (completionRepository.ts); the router (feature.server.ts) maps the results
// to HTTP and gates them behind the bearer.
import type { Database } from 'better-sqlite3';
import { getPerson, listPeople } from '../../server/db/personRepository.js';
import { toPersonWire } from '../../server/people.js';
import { listChores } from './choreRepository.js';
import type { Completion } from './completion.js';
import { getCompletion, insertCompletion, listCompletionsSince, voidCompletion } from './completionRepository.js';
import type { CompletionsResponse } from './types.js';

/** The longest the admin correction list reaches back, and its default. */
export const CORRECTION_LIST_MAX_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The admin correction list: every completion of the last `days` × 24
 * hours before `now`, newest first, voided ones included with their reasons
 * (the one list that shows them).
 */
export function readCorrectionList(db: Database, now: Date, days: number): CompletionsResponse {
  const since = new Date(now.getTime() - days * DAY_MS);
  const names = new Map(listChores(db).map((chore) => [chore.id, chore.name]));
  return {
    since: since.getTime(),
    people: listPeople(db).map(toPersonWire),
    completions: listCompletionsSince(db, since).map((completion) => ({
      id: completion.id,
      choreId: completion.choreId,
      choreName: names.get(completion.choreId) ?? '',
      personId: completion.personId,
      completedAt: completion.completedAt.getTime(),
      pointsAwarded: completion.pointsAwarded,
      voided:
        completion.voided === null
          ? null
          : {
              voidedAt: completion.voided.voidedAt.getTime(),
              reason: completion.voided.reason,
            },
    })),
  };
}

export type VoidResult = { kind: 'voided' } | { kind: 'no-completion' };

/** Voids completion `id` at `now` with reason correction. One already voided counts as gone. */
export function voidAsCorrection(db: Database, id: number, now: Date): VoidResult {
  return db.transaction((): VoidResult => {
    const completion = getCompletion(db, id);
    if (completion === undefined || completion.voided !== null) return { kind: 'no-completion' };
    voidCompletion(db, id, now, 'correction');
    return { kind: 'voided' };
  })();
}

export type ReassignResult =
  | { kind: 'reassigned'; completion: Completion }
  /** Unknown, or already voided. */
  | { kind: 'no-completion' }
  | { kind: 'no-person' }
  /** `personId` already has it. */
  | { kind: 'same-person' };

/**
 * Moves completion `id` to `personId`: voids it at `now` with reason
 * correction and records a new completion for `personId` at the original's
 * instant with the original's points, in one transaction, so a Sunday claim
 * fixed on Monday stays in last week. The two rows are not linked.
 */
export function reassignCompletion(db: Database, id: number, personId: number, now: Date): ReassignResult {
  return db.transaction((): ReassignResult => {
    const original = getCompletion(db, id);
    if (original === undefined || original.voided !== null) return { kind: 'no-completion' };
    if (getPerson(db, personId) === undefined) return { kind: 'no-person' };
    if (original.personId === personId) return { kind: 'same-person' };
    voidCompletion(db, id, now, 'correction');
    const completion = insertCompletion(db, {
      choreId: original.choreId,
      personId,
      completedAt: original.completedAt,
      pointsAwarded: original.pointsAwarded,
    });
    return { kind: 'reassigned', completion };
  })();
}
