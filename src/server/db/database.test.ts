import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
import type { ServerFeature } from '../../features/types.js';
import { testConfig } from '../../../test/helpers/app.js';
import { openDatabase, prepareDatabase } from './database.js';
import { MigrationError } from './migrate.js';
import { coreMigrations } from './schema.js';

const BOOT = new Date('2026-10-23T14:00:00.000Z');

const chores = {
  id: 'chores',
  name: 'Chores',
  migrations: [{ id: 1, name: 'create chore', sql: 'CREATE TABLE chore (id INTEGER PRIMARY KEY) STRICT' }],
} satisfies ServerFeature;

describe('openDatabase', () => {
  it('opens DATA_DIR/hearth.db with foreign keys enforced and write-ahead logging', () => {
    const { dataDir } = testConfig();

    const db = openDatabase(dataDir);
    onTestFinished(() => {
      db.close();
    });

    expect(db.name).toBe(join(dataDir, 'hearth.db'));
    expect(existsSync(join(dataDir, 'hearth.db'))).toBe(true);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
  });
});

describe('prepareDatabase', () => {
  it('opens the database and applies the core set, then each feature set', () => {
    const { dataDir } = testConfig();

    const { db, applied } = prepareDatabase(dataDir, [chores], BOOT);
    onTestFinished(() => {
      db.close();
    });

    expect(db.open).toBe(true);
    expect(applied).toEqual([
      ...coreMigrations.map((m) => ({ scope: 'core', id: m.id, name: m.name })),
      { scope: 'chores', id: 1, name: 'create chore' },
    ]);
  });

  it('throws on a broken pending migration and leaves the database file byte for byte as it was', () => {
    const { dataDir } = testConfig();
    prepareDatabase(dataDir, [chores], BOOT).db.close();
    const file = join(dataDir, 'hearth.db');
    const before = readFileSync(file);
    const broken = {
      ...chores,
      migrations: [
        ...chores.migrations,
        {
          id: 2,
          name: 'add chore points',
          sql: `ALTER TABLE chore ADD COLUMN points INTEGER;
                INSERT INTO no_such_table VALUES (1);`,
        },
      ],
    } satisfies ServerFeature;

    expect(() => prepareDatabase(dataDir, [broken], BOOT)).toThrow(MigrationError);

    // The handle was closed, so its write-ahead log is checkpointed and gone.
    expect(existsSync(`${file}-wal`)).toBe(false);
    expect(readFileSync(file).equals(before)).toBe(true);
  });
});
