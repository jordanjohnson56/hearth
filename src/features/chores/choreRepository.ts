// Repository for the chore table: the only SQL about chore definitions.
// Names are unique ignoring case (the chore_name index). The rule is JSON
// text checked by parseRule on the way in and again on the way out: a
// stored rule the code cannot read is a bug (docs/adr/0005), so the read
// throws instead of dropping the chore.
import type { Database } from 'better-sqlite3';
import type { LocalDate } from '../../core/time.js';
import { withUniqueName } from '../../server/db/uniqueName.js';
import { parseRule } from './rule.js';
import type { RecurrenceRule } from './rule.js';

export interface Chore {
  id: number;
  name: string;
  rule: RecurrenceRule;
  points: number;
  startDate: LocalDate;
  archivedAt: Date | null;
  createdAt: Date;
}

export interface ChoreInput {
  name: string;
  rule: RecurrenceRule;
  points: number;
  startDate: LocalDate;
}

export interface ChorePatch extends Partial<ChoreInput> {
  /** true archives (keeping an earlier archive instant), false unarchives. */
  archived?: boolean;
}

/** The name is taken, ignoring case. */
export class DuplicateChoreNameError extends Error {
  override name = 'DuplicateChoreNameError';
  constructor() {
    super('Another chore already has that name');
  }
}

/** A stored rule parseRule refuses: a code or data bug, never bad input. */
export class UnreadableRuleError extends Error {
  override name = 'UnreadableRuleError';
  constructor(choreId: number, reason: string) {
    super(`chore ${String(choreId)} has a rule Hearth cannot read: ${reason}`);
  }
}

interface ChoreRow {
  id: number;
  name: string;
  rule: string;
  points: number;
  start_date: string;
  archived_at: number | null;
  created_at: number;
}

const COLUMNS = 'id, name, rule, points, start_date, archived_at, created_at';

function readRule(row: ChoreRow): RecurrenceRule {
  let value: unknown;
  try {
    value = JSON.parse(row.rule);
  } catch {
    throw new UnreadableRuleError(row.id, 'not JSON');
  }
  const check = parseRule(value);
  if (!check.ok) throw new UnreadableRuleError(row.id, check.message);
  return check.rule;
}

function toChore(row: ChoreRow): Chore {
  return {
    id: row.id,
    name: row.name,
    rule: readRule(row),
    points: row.points,
    // date(start_date) IS start_date holds for every stored row.
    startDate: row.start_date as LocalDate,
    archivedAt: row.archived_at === null ? null : new Date(row.archived_at),
    createdAt: new Date(row.created_at),
  };
}

/** Every chore, archived ones included, by name ignoring case. */
export function listChores(db: Database): Chore[] {
  const rows = db.prepare(`SELECT ${COLUMNS} FROM chore ORDER BY name COLLATE NOCASE, id`).all() as ChoreRow[];
  return rows.map(toChore);
}

export function getChore(db: Database, id: number): Chore | undefined {
  const row = db.prepare(`SELECT ${COLUMNS} FROM chore WHERE id = ?`).get(id) as ChoreRow | undefined;
  return row === undefined ? undefined : toChore(row);
}

/** Inserts an active chore. Throws DuplicateChoreNameError. */
export function insertChore(db: Database, input: ChoreInput, createdAt: Date): Chore {
  const row = withNameCheck(
    () =>
      db
        .prepare(
          `INSERT INTO chore (name, rule, points, start_date, created_at)
           VALUES (?, ?, ?, ?, ?) RETURNING ${COLUMNS}`,
        )
        .get(input.name, JSON.stringify(input.rule), input.points, input.startDate, createdAt.getTime()) as ChoreRow,
  );
  return toChore(row);
}

/**
 * Applies `patch` in one statement, so a refused rename changes nothing.
 * Archiving stamps `now` unless the chore is already archived. Returns the
 * chore, or undefined when there is no such chore. Throws
 * DuplicateChoreNameError.
 */
export function updateChore(db: Database, id: number, patch: ChorePatch, now: Date): Chore | undefined {
  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  if (patch.name !== undefined) {
    sets.push('name = ?');
    values.push(patch.name);
  }
  if (patch.rule !== undefined) {
    sets.push('rule = ?');
    values.push(JSON.stringify(patch.rule));
  }
  if (patch.points !== undefined) {
    sets.push('points = ?');
    values.push(patch.points);
  }
  if (patch.startDate !== undefined) {
    sets.push('start_date = ?');
    values.push(patch.startDate);
  }
  if (patch.archived !== undefined) {
    sets.push(patch.archived ? 'archived_at = coalesce(archived_at, ?)' : 'archived_at = NULL');
    if (patch.archived) values.push(now.getTime());
  }
  if (sets.length === 0) return getChore(db, id);
  const row = withNameCheck(
    () =>
      db.prepare(`UPDATE chore SET ${sets.join(', ')} WHERE id = ? RETURNING ${COLUMNS}`).get(...values, id) as
        | ChoreRow
        | undefined,
  );
  return row === undefined ? undefined : toChore(row);
}

function withNameCheck<T>(write: () => T): T {
  return withUniqueName(write, 'chore.name', () => new DuplicateChoreNameError());
}
