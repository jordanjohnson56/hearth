// The chores#1 tables, driven with SQL against a real SQLite file: what the
// database itself refuses, whatever code writes to it.
import { describe, expect, it } from 'vitest';
import { tempDatabase } from '../../../test/helpers/sqlite.js';
import { runMigrations } from '../../server/db/migrate.js';
import { upsertPersonByDisplayName } from '../../server/db/personRepository.js';
import { migrationSets } from '../../server/db/schema.js';
import { choresServer } from './feature.server.js';

const AT = Date.UTC(2026, 9, 23, 17);

function choresDatabase() {
  const { db } = tempDatabase();
  db.pragma('foreign_keys = ON');
  runMigrations(db, migrationSets([choresServer]), new Date(AT));
  upsertPersonByDisplayName(db, { displayName: 'Ada', color: 'ember' });
  return db;
}

type Db = ReturnType<typeof choresDatabase>;

const insertChore = (db: Db, row: Record<string, unknown> = {}) =>
  db
    .prepare(
      `INSERT INTO chore (name, rule, points, start_date, archived_at, created_at)
       VALUES (@name, @rule, @points, @start_date, @archived_at, @created_at)`,
    )
    .run({
      name: 'Feed the dog',
      rule: '{"kind":"daily"}',
      points: 2,
      start_date: '2026-10-01',
      archived_at: null,
      created_at: AT,
      ...row,
    });

const insertCompletion = (db: Db, row: Record<string, unknown> = {}) =>
  db
    .prepare(
      `INSERT INTO completion (chore_id, person_id, completed_at, points_awarded)
       VALUES (@chore_id, @person_id, @completed_at, @points_awarded)`,
    )
    .run({ chore_id: 1, person_id: 1, completed_at: AT, points_awarded: 2, ...row });

const insertVoid = (db: Db, row: Record<string, unknown> = {}) =>
  db
    .prepare('INSERT INTO completion_void (completion_id, voided_at, reason) VALUES (@completion_id, @voided_at, @reason)')
    .run({ completion_id: 1, voided_at: AT, reason: 'undo', ...row });

describe('chore', () => {
  it('accepts a chore, archived or not, with 1 and 1000 points', () => {
    const db = choresDatabase();
    insertChore(db, { points: 1 });
    insertChore(db, { name: 'Shovel the snow', points: 1000, archived_at: AT });

    expect(db.prepare('SELECT count(*) FROM chore').pluck().get()).toBe(2);
  });

  it.each([
    ['an empty name', { name: '' }],
    ['a name with surrounding spaces', { name: 'Feed the dog ' }],
    ['an empty rule', { rule: '' }],
    ['0 points', { points: 0 }],
    ['1001 points', { points: 1001 }],
    ['an impossible start date', { start_date: '2026-02-30' }],
    ['a start date with a time', { start_date: '2026-10-01T00:00' }],
  ])('rejects %s', (_label, row) => {
    expect(() => insertChore(choresDatabase(), row)).toThrow(/CHECK constraint failed/);
  });

  it.each([
    ['fractional points', { points: 2.5 }],
    ['points as text', { points: 'two' }],
    ['an instant as text', { created_at: '2026-10-23T17:00:00Z' }],
  ])('rejects %s, being STRICT', (_label, row) => {
    expect(() => insertChore(choresDatabase(), row)).toThrow(/cannot store/);
  });

  it('rejects a second chore whose name differs only in case', () => {
    const db = choresDatabase();
    insertChore(db);
    expect(() => insertChore(db, { name: 'FEED THE DOG' })).toThrow(/UNIQUE constraint failed/);
  });
});

describe('completion', () => {
  function withChore() {
    const db = choresDatabase();
    insertChore(db);
    return db;
  }

  it('accepts a completion of an existing chore by an existing person', () => {
    const db = withChore();
    insertCompletion(db);
    expect(db.prepare('SELECT count(*) FROM completion').pluck().get()).toBe(1);
  });

  it.each([
    ['0 points awarded', { points_awarded: 0 }],
    ['an instant in seconds', { completed_at: Math.floor(AT / 1000) }],
  ])('rejects %s', (_label, row) => {
    expect(() => insertCompletion(withChore(), row)).toThrow(/CHECK constraint failed/);
  });

  it.each([
    ['an unknown chore', { chore_id: 9 }],
    ['an unknown person', { person_id: 9 }],
  ])('rejects %s', (_label, row) => {
    expect(() => insertCompletion(withChore(), row)).toThrow(/FOREIGN KEY constraint failed/);
  });
});

describe('completion_void', () => {
  function withCompletion() {
    const db = choresDatabase();
    insertChore(db);
    insertCompletion(db);
    return db;
  }

  it.each(['undo', 'correction'])('accepts a void with reason %s', (reason) => {
    const db = withCompletion();
    insertVoid(db, { reason });
    expect(db.prepare('SELECT reason FROM completion_void').pluck().all()).toEqual([reason]);
  });

  it('rejects a second void of the same completion', () => {
    const db = withCompletion();
    insertVoid(db);
    expect(() => insertVoid(db, { reason: 'correction' })).toThrow(/UNIQUE constraint failed/);
  });

  it('rejects a reason other than undo or correction', () => {
    expect(() => insertVoid(withCompletion(), { reason: 'mistake' })).toThrow(/CHECK constraint failed/);
  });

  it('rejects a void of an unknown completion', () => {
    expect(() => insertVoid(withCompletion(), { completion_id: 9 })).toThrow(/FOREIGN KEY constraint failed/);
  });
});
