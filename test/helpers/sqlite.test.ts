import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { tempDatabase } from './sqlite.js';
import type { TempDatabase } from './sqlite.js';

describe('tempDatabase', () => {
  it('opens a fresh, writable SQLite file outside the repo tree', () => {
    const { db, path } = tempDatabase();

    expect(path.startsWith(tmpdir())).toBe(true);
    expect(existsSync(path)).toBe(true);
    expect(db.prepare('SELECT count(*) AS n FROM sqlite_schema').get()).toEqual({ n: 0 });

    db.exec('CREATE TABLE person (name TEXT NOT NULL)');
    db.prepare('INSERT INTO person (name) VALUES (?)').run('Ada');
    expect(db.prepare('SELECT name FROM person').all()).toEqual([{ name: 'Ada' }]);
  });

  it('gives each call its own file', () => {
    const a = tempDatabase();
    const b = tempDatabase();

    expect(a.path).not.toBe(b.path);
    a.db.exec('CREATE TABLE only_in_a (x)');
    expect(b.db.prepare('SELECT count(*) AS n FROM sqlite_schema').get()).toEqual({ n: 0 });
  });

  describe('cleanup', () => {
    // Tests in a file run in order: the first creates, the second checks
    // that the first test's teardown closed and deleted it.
    let fromPreviousTest: TempDatabase | undefined;

    it('creates a database', () => {
      fromPreviousTest = tempDatabase();
      expect(existsSync(fromPreviousTest.path)).toBe(true);
    });

    it('has closed and deleted it once that test finished', () => {
      expect(fromPreviousTest?.db.open).toBe(false);
      expect(existsSync(fromPreviousTest?.path ?? '')).toBe(false);
    });
  });
});
