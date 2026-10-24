// Repository for the completion log: the only SQL about completion and
// completion_void. The log is append-only (docs/DESIGN.md section 5): this
// module only ever inserts. A mistaken completion gets a completion_void row;
// a reassignment (M2.6) voids one and inserts another. completionRepository
// .test.ts reads every source file and fails on an UPDATE or DELETE that
// names either table.
import type { Database } from 'better-sqlite3';
import type { Completion, VoidReason } from './completion.js';

export interface CompletionInput {
  choreId: number;
  personId: number;
  completedAt: Date;
  pointsAwarded: number;
}

interface CompletionRow {
  id: number;
  chore_id: number;
  person_id: number;
  completed_at: number;
  points_awarded: number;
  voided_at: number | null;
  reason: VoidReason | null;
}

const SELECT = `
  SELECT c.id, c.chore_id, c.person_id, c.completed_at, c.points_awarded, v.voided_at, v.reason
  FROM completion c LEFT JOIN completion_void v ON v.completion_id = c.id`;

function toCompletion(row: CompletionRow): Completion {
  return {
    id: row.id,
    choreId: row.chore_id,
    personId: row.person_id,
    completedAt: new Date(row.completed_at),
    pointsAwarded: row.points_awarded,
    // The reason CHECK keeps the pair together: both null or both set.
    voided:
      row.voided_at === null || row.reason === null ? null : { voidedAt: new Date(row.voided_at), reason: row.reason },
  };
}

/** Appends a completion. A chore or person that does not exist is a foreign-key error. */
export function insertCompletion(db: Database, input: CompletionInput): Completion {
  const { id } = db
    .prepare(
      `INSERT INTO completion (chore_id, person_id, completed_at, points_awarded)
       VALUES (?, ?, ?, ?) RETURNING id`,
    )
    .get(input.choreId, input.personId, input.completedAt.getTime(), input.pointsAwarded) as { id: number };
  return { id, ...input, voided: null };
}

export function getCompletion(db: Database, id: number): Completion | undefined {
  const row = db.prepare(`${SELECT} WHERE c.id = ?`).get(id) as CompletionRow | undefined;
  return row === undefined ? undefined : toCompletion(row);
}

/**
 * Records that completion `id` no longer counts. Returns false, and changes
 * nothing, when it was already voided. The completion must exist.
 */
export function voidCompletion(db: Database, id: number, voidedAt: Date, reason: VoidReason): boolean {
  const result = db
    .prepare(
      `INSERT INTO completion_void (completion_id, voided_at, reason) VALUES (?, ?, ?)
       ON CONFLICT (completion_id) DO NOTHING`,
    )
    .run(id, voidedAt.getTime(), reason);
  return result.changes === 1;
}

/**
 * Every completion whose instant is `since` or later, newest first (then
 * newest id), voided ones included and marked: callers that count or show
 * completions skip them, except the admin correction list.
 */
export function listCompletionsSince(db: Database, since: Date): Completion[] {
  const rows = db
    .prepare(`${SELECT} WHERE c.completed_at >= ? ORDER BY c.completed_at DESC, c.id DESC`)
    .all(since.getTime()) as CompletionRow[];
  return rows.map(toCompletion);
}

// Per chore, its newest completion without a void row.
const LATEST_COUNTED = `
  SELECT id, chore_id, person_id, completed_at, points_awarded, NULL AS voided_at, NULL AS reason
  FROM (
    SELECT c.*, row_number() OVER (PARTITION BY c.chore_id ORDER BY c.completed_at DESC, c.id DESC) AS n
    FROM completion c
    WHERE NOT EXISTS (SELECT 1 FROM completion_void v WHERE v.completion_id = c.id)
  )
  WHERE n = 1`;

/**
 * Each chore's latest completion that was not voided, by chore id; a chore
 * with none is absent. This is all the pool needs (pool.ts).
 */
export function latestCountedCompletions(db: Database): Map<number, Completion> {
  const rows = db.prepare(`${LATEST_COUNTED} ORDER BY chore_id`).all() as CompletionRow[];
  return new Map(rows.map((row) => [row.chore_id, toCompletion(row)]));
}

/** Chore `choreId`'s latest completion that was not voided, if any. */
export function latestCountedCompletion(db: Database, choreId: number): Completion | undefined {
  const row = db.prepare(`${LATEST_COUNTED} AND chore_id = ?`).get(choreId) as CompletionRow | undefined;
  return row === undefined ? undefined : toCompletion(row);
}
