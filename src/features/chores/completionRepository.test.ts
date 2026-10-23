import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { tempDatabase } from '../../../test/helpers/sqlite.js';
import type { LocalDate } from '../../core/time.js';
import { runMigrations } from '../../server/db/migrate.js';
import { upsertPersonByDisplayName } from '../../server/db/personRepository.js';
import { migrationSets } from '../../server/db/schema.js';
import { insertChore } from './choreRepository.js';
import {
  getCompletion,
  insertCompletion,
  latestCountedCompletion,
  latestCountedCompletions,
  listCompletionsSince,
  voidCompletion,
} from './completionRepository.js';
import { choresServer } from './feature.server.js';

const AT = new Date('2026-10-23T17:00:00Z');
const MINUTE_MS = 60_000;
const minutesAfter = (minutes: number) => new Date(AT.getTime() + minutes * MINUTE_MS);

/** Chores 1 (Feed the dog) and 2 (Wash the car); Ada is person 1 and Linus 2. */
function choresDatabase() {
  const { db } = tempDatabase();
  db.pragma('foreign_keys = ON');
  runMigrations(db, migrationSets([choresServer]), AT);
  upsertPersonByDisplayName(db, { displayName: 'Ada', color: 'ember' });
  upsertPersonByDisplayName(db, { displayName: 'Linus', color: 'lake' });
  const start = '2026-10-01' as LocalDate;
  insertChore(db, { name: 'Feed the dog', rule: { kind: 'daily' }, points: 2, startDate: start }, AT);
  insertChore(db, { name: 'Wash the car', rule: { kind: 'whenever' }, points: 5, startDate: start }, AT);
  return db;
}

describe('completion repository', () => {
  it('records a completion and reads it back as counting', () => {
    const db = choresDatabase();

    const completion = insertCompletion(db, { choreId: 1, personId: 2, completedAt: AT, pointsAwarded: 2 });

    expect(completion).toEqual({ id: 1, choreId: 1, personId: 2, completedAt: AT, pointsAwarded: 2, voided: null });
    expect(getCompletion(db, 1)).toEqual(completion);
    expect(getCompletion(db, 2)).toBeUndefined();
  });

  it('voids a completion once, with its instant and reason', () => {
    const db = choresDatabase();
    insertCompletion(db, { choreId: 1, personId: 1, completedAt: AT, pointsAwarded: 2 });

    const first = voidCompletion(db, 1, minutesAfter(0.2), 'undo');
    const second = voidCompletion(db, 1, minutesAfter(5), 'correction');

    expect([first, second]).toEqual([true, false]);
    expect(getCompletion(db, 1)?.voided).toEqual({ voidedAt: minutesAfter(0.2), reason: 'undo' });
  });

  it('lists the completions from an instant on, newest first, voided ones marked', () => {
    const db = choresDatabase();
    insertCompletion(db, { choreId: 1, personId: 1, completedAt: minutesAfter(-1), pointsAwarded: 2 });
    insertCompletion(db, { choreId: 1, personId: 1, completedAt: minutesAfter(10), pointsAwarded: 2 });
    insertCompletion(db, { choreId: 2, personId: 2, completedAt: AT, pointsAwarded: 5 });
    voidCompletion(db, 3, minutesAfter(1), 'undo');

    const listed = listCompletionsSince(db, AT);

    expect(listed.map((c) => [c.id, c.voided?.reason ?? null])).toEqual([
      [2, null],
      [3, 'undo'],
    ]);
  });

  it("gives each chore's latest completion that still counts", () => {
    const db = choresDatabase();
    insertCompletion(db, { choreId: 1, personId: 1, completedAt: minutesAfter(-60), pointsAwarded: 2 });
    insertCompletion(db, { choreId: 1, personId: 2, completedAt: minutesAfter(-30), pointsAwarded: 2 });
    insertCompletion(db, { choreId: 1, personId: 1, completedAt: AT, pointsAwarded: 2 });
    voidCompletion(db, 3, minutesAfter(0.1), 'undo');
    insertCompletion(db, { choreId: 2, personId: 2, completedAt: AT, pointsAwarded: 5 });
    voidCompletion(db, 4, minutesAfter(0.1), 'undo');

    const latest = latestCountedCompletions(db);

    expect([...latest.entries()].map(([choreId, c]) => [choreId, c.id])).toEqual([[1, 2]]);
    expect(latestCountedCompletion(db, 1)).toEqual(latest.get(1));
    expect(latestCountedCompletion(db, 2)).toBeUndefined();
  });

  it('refuses a completion of a chore or person that does not exist', () => {
    const db = choresDatabase();

    expect(() => insertCompletion(db, { choreId: 9, personId: 1, completedAt: AT, pointsAwarded: 2 })).toThrow(
      /FOREIGN KEY/,
    );
  });
});

describe('the completion log', () => {
  const srcRoot = fileURLToPath(new URL('../..', import.meta.url));
  // Any statement that would change or remove a completion or a void row.
  const REWRITE = /\b(?:UPDATE(?:\s+OR\s+\w+)?|DELETE\s+FROM|REPLACE\s+INTO|INSERT\s+OR\s+REPLACE\s+INTO)\s+["`]?completion(?:_void)?\b/i;

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
    });
  }

  it('is recognised by the matcher when a statement would rewrite it', () => {
    expect(REWRITE.test('UPDATE completion SET points_awarded = 1')).toBe(true);
    expect(REWRITE.test('delete from completion_void where completion_id = ?')).toBe(true);
    expect(REWRITE.test('INSERT OR REPLACE INTO completion (id) VALUES (1)')).toBe(true);
    expect(REWRITE.test('UPDATE chore SET points = 3')).toBe(false);
  });

  it('is append-only: no source file updates or deletes a completion or a void', () => {
    const files = sourceFiles(srcRoot);
    expect(files.map((file) => relative(srcRoot, file))).toContain(join('features', 'chores', 'completionRepository.ts'));

    const offenders = files.filter((file) => REWRITE.test(readFileSync(file, 'utf8')));

    expect(offenders.map((file) => relative(srcRoot, file))).toEqual([]);
  });
});
