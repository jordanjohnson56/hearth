// Repository for the setting table: the only module that holds SQL about
// settings. A setting is one text value under a key. Each key's value format
// (an HH:MM time, a scrypt hash, ...) belongs to the code that reads that
// key; this module neither parses nor validates values.
import type { Database } from 'better-sqlite3';

interface SettingRow {
  value: string;
}

/** The value stored under `key`, or undefined when nothing has been written. */
export function readSetting(db: Database, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM setting WHERE key = ?').get(key) as
    | SettingRow
    | undefined;
  return row?.value;
}

/** Stores `value` under `key`, replacing any earlier value. */
export function writeSetting(db: Database, key: string, value: string): void {
  db.prepare(
    `INSERT INTO setting (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
}
