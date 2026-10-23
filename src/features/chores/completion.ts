// The completion log's records as the pure core and the services see them
// (GLOSSARY: completion, void). Types only: the rows live in
// completionRepository.ts, which never updates or deletes one.

export const VOID_REASONS = ['undo', 'correction'] as const;
/** undo: from the wall within the undo window; correction: an admin's void or reassignment. */
export type VoidReason = (typeof VOID_REASONS)[number];

export interface CompletionVoid {
  voidedAt: Date;
  reason: VoidReason;
}

export interface Completion {
  id: number;
  choreId: number;
  personId: number;
  /** The instant of the claim (a reassignment keeps the original's). */
  completedAt: Date;
  /** The chore's points at the moment of the claim. */
  pointsAwarded: number;
  /** Its void, or null while it counts. */
  voided: CompletionVoid | null;
}
