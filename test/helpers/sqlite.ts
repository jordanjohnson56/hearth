import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { onTestFinished } from 'vitest';

export interface TempDatabase {
  db: Database.Database;
  /** Absolute path of the SQLite file, in its own directory under the OS temp dir. */
  path: string;
}

/**
 * Opens a throwaway SQLite file for the current test. The database is a
 * real file (not `:memory:`), so it behaves like DATA_DIR/hearth.db,
 * including WAL side files. It is closed and its directory deleted when the
 * test finishes. Call it inside a test, not at module or describe level.
 */
export function tempDatabase(): TempDatabase {
  const dir = mkdtempSync(join(tmpdir(), 'hearth-test-db-'));
  const path = join(dir, 'hearth.db');
  const db = new Database(path);

  onTestFinished(() => {
    if (db.open) db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  return { db, path };
}
