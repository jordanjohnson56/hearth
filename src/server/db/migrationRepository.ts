// Repository for the migration tracking table: the only module that holds
// SQL about it. The table is created here rather than by a migration,
// because the runner must read it before it can know which migrations ran.
import type { Database } from 'better-sqlite3';

export interface MigrationRecord {
  /** 'core' or a FeatureId. Not checked against a list, so adding a feature never alters this table. */
  scope: string;
  id: number;
  name: string;
  appliedAt: Date;
}

interface MigrationRow {
  scope: string;
  id: number;
  name: string;
  applied_at: number;
}

export function ensureMigrationTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migration (
      scope      TEXT    NOT NULL CHECK (scope <> ''),
      id         INTEGER NOT NULL CHECK (id >= 1),
      name       TEXT    NOT NULL CHECK (name <> ''),
      applied_at INTEGER NOT NULL,
      PRIMARY KEY (scope, id)
    ) STRICT
  `);
}

/**
 * Every recorded migration, in the order it was applied (rows are only ever
 * inserted, so rowid order is insertion order). Empty, without creating the
 * table, on a database that has never been migrated.
 */
export function listMigrations(db: Database): MigrationRecord[] {
  const exists = db
    .prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'migration'")
    .get();
  if (exists === undefined) return [];
  const rows = db
    .prepare('SELECT scope, id, name, applied_at FROM migration ORDER BY rowid')
    .all() as MigrationRow[];
  return rows.map((row) => ({
    scope: row.scope,
    id: row.id,
    name: row.name,
    appliedAt: new Date(row.applied_at),
  }));
}

/** Whether (scope, id) has a tracking row. The table must exist. */
export function isMigrationRecorded(db: Database, scope: string, id: number): boolean {
  return (
    db.prepare('SELECT 1 FROM migration WHERE scope = ? AND id = ?').get(scope, id) !== undefined
  );
}

export function insertMigration(db: Database, record: MigrationRecord): void {
  db.prepare(
    'INSERT INTO migration (scope, id, name, applied_at) VALUES (?, ?, ?, ?)',
  ).run(record.scope, record.id, record.name, record.appliedAt.getTime());
}
