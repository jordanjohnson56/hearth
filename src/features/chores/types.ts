// Wire shapes of the chores API, shared by the server and the client.
// Instants are epoch milliseconds, local dates YYYY-MM-DD (docs/adr/0004).
import type { PersonWire } from '../../core/person.js';
import type { LocalDate } from '../../core/time.js';
import type { VoidReason } from './completion.js';
import type { RecurrenceRule } from './rule.js';
import type { Standing } from './standings.js';

/** A chore definition as GET/POST/PATCH /api/chores/definitions return it. */
export interface ChoreWire {
  id: number;
  name: string;
  rule: RecurrenceRule;
  /** 1–1000. Copied onto each completion when it is claimed. */
  points: number;
  startDate: LocalDate;
  /** When it was archived, or null for an active chore. */
  archivedAt: number | null;
  createdAt: number;
}

export interface DefinitionsResponse {
  /** Every chore, archived ones included, by name ignoring case. */
  chores: ChoreWire[];
}

/** POST /api/chores/definitions. `startDate` defaults to today in the configured zone. */
export interface ChoreInputWire {
  name: string;
  rule: RecurrenceRule;
  points: number;
  startDate?: string;
}

/** PATCH /api/chores/definitions/:id: at least one field. */
export interface ChorePatchWire {
  name?: string;
  rule?: RecurrenceRule;
  points?: number;
  startDate?: string;
  archived?: boolean;
}

// The board (GET /api/chores/board): everything the Chores today tile, the
// Leaderboard tile and the Chores page show, in one public response. The
// states are the server's, worked out in the configured zone; the client
// never recomputes them from its own clock.

/** What every board section says about a chore. */
export interface BoardChoreWire {
  id: number;
  name: string;
  /** The chore's points now: what a claim would award. */
  points: number;
}

/** A waiting chore. A due-today chore is never late. */
export type WaitingChoreWire = BoardChoreWire &
  (
    | {
        state: 'overdue';
        /** Whole days since its earliest unsatisfied due date, at least 1. */
        daysLate: number;
      }
    | { state: 'due-today' }
  );

/** An anytime chore (rule whenever): claimable unless claimed today. */
export interface AnytimeChoreWire extends BoardChoreWire {
  claimedToday: boolean;
}

/** A scheduled chore that is not waiting. */
export interface UpcomingChoreWire extends BoardChoreWire {
  /** Its next due date after today. */
  nextDue: LocalDate;
}

/** A completion as POST /api/chores/:id/claims returns it (201). */
export interface CompletionWire {
  id: number;
  choreId: number;
  personId: number;
  completedAt: number;
  pointsAwarded: number;
}

/** A completion of this week that counts. */
export interface BoardCompletionWire extends CompletionWire {
  /** The chore's current name (it may be archived since). */
  choreName: string;
}

export type StandingWire = Standing;

export interface BoardResponse {
  /** The configured zone's local date the states were worked out for. */
  today: LocalDate;
  /** The instant this week began: Monday 00:00 in the configured zone. */
  weekStart: number;
  /** Everyone, in creation order: the completions and standings name them by id. */
  people: PersonWire[];
  /** The pool: overdue first (latest first), then due today, each by points descending then name. */
  waiting: WaitingChoreWire[];
  /** By name ignoring case. */
  anytime: AnytimeChoreWire[];
  /** By next due date, then points descending, then name. */
  upcoming: UpcomingChoreWire[];
  /** This week's completions that count, newest first. */
  completions: BoardCompletionWire[];
  /** Everyone, those on zero included, by points descending then name. */
  standings: StandingWire[];
}

/** POST /api/chores/:id/claims. */
export interface ClaimInputWire {
  personId: number;
}

// Corrections (bearer): POST /api/chores/completions/:id/void answers 204;
// POST /api/chores/completions/:id/reassign takes ClaimInputWire and answers
// 201 with the new CompletionWire.

/** A completion in the admin correction list, voided or not. */
export interface AdminCompletionWire extends BoardCompletionWire {
  /** Its void, or null while it counts. */
  voided: { voidedAt: number; reason: VoidReason } | null;
}

/** GET /api/chores/completions?days=N (1–14, default 14). */
export interface CompletionsResponse {
  /** The instant the list starts: N × 24 hours before now. */
  since: number;
  /** Everyone, in creation order: the completions name them by id, and a reassignment picks from them. */
  people: PersonWire[];
  /** Every completion since `since`, voided ones included, newest first. */
  completions: AdminCompletionWire[];
}
