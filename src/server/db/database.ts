import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { ServerFeature } from '../../features/types.js';
import { runMigrations } from './migrate.js';
import type { MigrationRef } from './migrate.js';
import { migrationSets } from './schema.js';

/** The SQLite file's name inside DATA_DIR. */
export const DATABASE_FILE = 'hearth.db';

/**
 * Opens (creating if needed) DATA_DIR/hearth.db. Foreign keys are a
 * per-connection setting in SQLite and off by default, so every connection
 * goes through here. WAL lets readers (API requests) run alongside a writer
 * (a poll job).
 */
export function openDatabase(dataDir: string): Database.Database {
  const db = new Database(join(dataDir, DATABASE_FILE));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}

export interface PreparedDatabase {
  db: Database.Database;
  /** What this boot applied; empty when the database was already up to date. */
  applied: MigrationRef[];
}

/**
 * The boot step: opens the database and applies every pending migration,
 * core first, then each feature's set in the order given. On failure the
 * handle is closed and the error (MigrationError or MigrationPlanError)
 * propagates, so the entrypoint can refuse to start.
 */
export function prepareDatabase(
  dataDir: string,
  features: readonly ServerFeature[],
  now: Date,
): PreparedDatabase {
  const db = openDatabase(dataDir);
  try {
    const { applied } = runMigrations(db, migrationSets(features), now);
    return { db, applied };
  } catch (error) {
    db.close();
    throw error;
  }
}
