// Wire shapes of the chores API, shared by the server and the client.
// Instants are epoch milliseconds, local dates YYYY-MM-DD (docs/adr/0004).
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
