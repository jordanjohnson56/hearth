// Wire shapes of the chores API, shared by the server and the client.
// Instants are epoch milliseconds, local dates YYYY-MM-DD (docs/adr/0004).
import type { PersonWire } from '../../core/person.js';
import type { RecurrenceRule } from './rule.js';

/** A chore definition as GET/POST/PATCH /api/chores/definitions return it. */
export interface ChoreWire {
  id: number;
  name: string;
  rule: RecurrenceRule;
  /** 1–1000. Copied onto each completion when it is claimed. */
  points: number;
  startDate: string;
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
  /** Its next due date after today, YYYY-MM-DD. */
  nextDue: string;
}

/** A completion of this week that counts. */
export interface BoardCompletionWire {
  id: number;
  choreId: number;
  /** The chore's current name (it may be archived since). */
  choreName: string;
  personId: number;
  completedAt: number;
  pointsAwarded: number;
}

export interface StandingWire {
  /** 1 for the most points; equal points share a rank (1, 1, 3). */
  rank: number;
  personId: number;
  points: number;
}

export interface BoardResponse {
  /** The configured zone's local date the states were worked out for. */
  today: string;
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

/** A completion as POST /api/chores/:id/claims returns it (201). */
export interface CompletionWire {
  id: number;
  choreId: number;
  personId: number;
  completedAt: number;
  pointsAwarded: number;
}
