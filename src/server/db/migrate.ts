// The migration runner. It takes a database handle and an ordered list of
// migration sets (core first, then features in registry order) and applies
// each pending migration in its own transaction together with its tracking
// row. It is its own test seam: tests pass sets of their own.
import type { Database } from 'better-sqlite3';
import type { FeatureId, Migration } from '../../features/types.js';
import {
  ensureMigrationTable,
  insertMigration,
  isMigrationRecorded,
  listMigrations,
} from './migrationRepository.js';
import type { MigrationRecord } from './migrationRepository.js';

/** Which set a migration belongs to. Ids are numbered from 1 within each scope. */
export type MigrationScope = 'core' | FeatureId;

export interface MigrationSet {
  scope: MigrationScope;
  /** Numbered 1, 2, 3… within the set, in order. */
  migrations: readonly Migration[];
}

export interface MigrationRef {
  scope: MigrationScope;
  id: number;
  name: string;
}

export interface MigrationRunResult {
  /** The migrations this run applied, in order. Empty when already up to date. */
  applied: MigrationRef[];
}

export type AppliedMigration = MigrationRecord;

/**
 * A migration failed and was rolled back; the run stopped there. Migrations
 * applied before it in the same run stay applied. The SQLite error is the
 * `cause`.
 */
export class MigrationError extends Error {
  override name = 'MigrationError';
  readonly scope: MigrationScope;
  readonly migrationId: number;
  readonly migrationName: string;

  constructor(migration: MigrationRef, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(
      `migration ${migration.scope}#${String(migration.id)} (${migration.name}) failed: ${reason}`,
      { cause },
    );
    this.scope = migration.scope;
    this.migrationId = migration.id;
    this.migrationName = migration.name;
  }
}

/**
 * The sets break the numbering rules, or disagree with what the database
 * records as applied. Thrown before anything is applied.
 */
export class MigrationPlanError extends Error {
  override name = 'MigrationPlanError';
}

const NEVER_EDITED = 'applied migrations are never removed or renumbered';

/**
 * Applies every pending migration, in set order and then id order, each in
 * its own transaction with its tracking row. `now` is recorded as each
 * one's applied-at instant.
 *
 * Throws MigrationPlanError (nothing applied) when the sets are misnumbered
 * or no longer contain an applied migration under the same id and name, and
 * MigrationError when a migration fails.
 */
export function runMigrations(
  db: Database,
  sets: readonly MigrationSet[],
  now: Date,
): MigrationRunResult {
  checkNumbering(sets);
  const done = new Map(listMigrations(db).map((record) => [key(record.scope, record.id), record]));
  checkAppliedStillPresent(sets, done.values());

  const pending = sets.flatMap((set) =>
    set.migrations
      .filter((migration) => !done.has(key(set.scope, migration.id)))
      .map((migration) => ({ scope: set.scope, migration })),
  );
  if (pending.length === 0) return { applied: [] };

  ensureMigrationTable(db);
  const applied: MigrationRef[] = [];
  for (const { scope, migration } of pending) {
    const ref = { scope, id: migration.id, name: migration.name };
    let ran: boolean;
    try {
      // IMMEDIATE takes the write lock up front, so two processes migrating
      // the same file (server boot and `npm run seed`) take turns. The
      // pending list above may be stale by now: re-check inside the lock and
      // skip what the other process already applied.
      ran = db
        .transaction(() => {
          if (isMigrationRecorded(db, scope, migration.id)) return false;
          db.exec(migration.sql);
          insertMigration(db, { ...ref, appliedAt: now });
          return true;
        })
        .immediate();
    } catch (error) {
      throw new MigrationError(ref, error);
    }
    if (ran) applied.push(ref);
  }
  return { applied };
}

/** Every migration recorded in the database, in the order it was applied. */
export function appliedMigrations(db: Database): AppliedMigration[] {
  return listMigrations(db);
}

function checkNumbering(sets: readonly MigrationSet[]): void {
  const seen = new Set<MigrationScope>();
  for (const set of sets) {
    if (seen.has(set.scope)) {
      throw new MigrationPlanError(`${set.scope}: migration set listed more than once`);
    }
    seen.add(set.scope);
    set.migrations.forEach((migration, index) => {
      if (migration.id !== index + 1) {
        throw new MigrationPlanError(
          `${set.scope}: migration ids must run 1, 2, 3… in order; found ${String(migration.id)} where ${String(index + 1)} belongs`,
        );
      }
    });
  }
}

function checkAppliedStillPresent(
  sets: readonly MigrationSet[],
  applied: Iterable<MigrationRecord>,
): void {
  const inCode = new Map(
    sets.flatMap((set) => set.migrations.map((m) => [key(set.scope, m.id), m.name] as const)),
  );
  for (const record of applied) {
    const name = inCode.get(key(record.scope, record.id));
    const ref = `${record.scope}#${String(record.id)}`;
    if (name === undefined) {
      throw new MigrationPlanError(
        `${ref} (${record.name}) is recorded as applied but is not in this build; ${NEVER_EDITED}`,
      );
    }
    if (name !== record.name) {
      throw new MigrationPlanError(
        `${ref} is recorded as applied with the name "${record.name}" but this build calls it "${name}"; ${NEVER_EDITED}`,
      );
    }
  }
}

function key(scope: string, id: number): string {
  return `${scope}#${String(id)}`;
}
