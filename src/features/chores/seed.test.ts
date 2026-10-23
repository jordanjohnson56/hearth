// The demo chores, against a throwaway SQLite file migrated like a real
// DATA_DIR and seeded with the fictional family. What a stranger's demo
// shows is read back through the board service.
import { describe, expect, it } from 'vitest';
import type { LocalDate } from '../../core/time.js';
import { serverFeatureList } from '../registry.server.js';
import { runMigrations } from '../../server/db/migrate.js';
import { migrationSets } from '../../server/db/schema.js';
import { seedFamily } from '../../server/db/seed.js';
import { tempDatabase } from '../../../test/helpers/sqlite.js';
import { readBoard } from './board.js';
import { insertChore, listChores } from './choreRepository.js';
import { listCompletionsSince } from './completionRepository.js';
import { RULE_KINDS } from './rule.js';
import { seedChores } from './seed.js';

// Friday 2026-10-23 12:00 in Chicago (CDT, UTC-5).
const NOW = new Date('2026-10-23T17:00:00Z');
const ZONE = 'America/Chicago';
const TODAY = '2026-10-23' as LocalDate;

function familyDatabase() {
  const { db } = tempDatabase();
  db.pragma('foreign_keys = ON');
  runMigrations(db, migrationSets(serverFeatureList), NOW);
  seedFamily(db);
  return db;
}

describe('seedChores', () => {
  it('creates fictional chores covering every rule kind, both every units, and no completions', () => {
    const db = familyDatabase();

    seedChores(db, NOW, ZONE);

    const chores = listChores(db);
    expect(new Set(chores.map((c) => c.rule.kind))).toEqual(new Set(RULE_KINDS));
    const units = chores.flatMap((c) => (c.rule.kind === 'every' ? [c.rule.unit] : []));
    expect(new Set(units)).toEqual(new Set(['days', 'weeks']));
    expect(chores.every((c) => c.archivedAt === null)).toBe(true);
    expect(listCompletionsSince(db, new Date(0))).toEqual([]);
  });

  it('gives the demo board an overdue chore, a chore due today, anytime and upcoming chores, and an all-zero leaderboard', () => {
    const db = familyDatabase();

    seedChores(db, NOW, ZONE);

    const board = readBoard(db, NOW, ZONE);
    expect(board.waiting.map((c) => c.name)).toEqual([
      'Feed the dog',
      'Take out the bins',
      'Empty the dishwasher',
    ]);
    expect(board.waiting).toEqual([
      expect.objectContaining({ name: 'Feed the dog', state: 'overdue', daysLate: 2 }),
      expect.objectContaining({ name: 'Take out the bins', state: 'overdue', daysLate: 1 }),
      expect.objectContaining({ name: 'Empty the dishwasher', state: 'due-today' }),
    ]);
    expect(board.anytime.map((c) => [c.name, c.claimedToday])).toEqual([
      ['Sort the recycling', false],
      ['Wash the car', false],
    ]);
    expect(board.upcoming.map((c) => [c.name, c.nextDue])).toEqual([
      ['Vacuum the hall', '2026-10-24'],
      ['Water the plants', '2026-10-24'],
      ['Clean the bathroom', '2026-10-26'],
      ['Change the sheets', '2026-11-01'],
    ]);
    expect(board.completions).toEqual([]);
    expect(board.standings.map((s) => [s.rank, s.points])).toEqual([
      [1, 0],
      [1, 0],
      [1, 0],
      [1, 0],
    ]);
  });

  it('is idempotent: a second run adds nothing and keeps the same chores', () => {
    const db = familyDatabase();
    seedChores(db, NOW, ZONE);
    const first = listChores(db);

    seedChores(db, new Date('2026-11-02T18:00:00Z'), ZONE);

    expect(listChores(db)).toEqual(first);
  });

  it('leaves a chore an admin already made under a seed name, ignoring case, as it is', () => {
    const db = familyDatabase();
    const mine = insertChore(
      db,
      { name: 'feed the dog', rule: { kind: 'weekly', days: ['sun'] }, points: 7, startDate: TODAY },
      NOW,
    );

    seedChores(db, NOW, ZONE);

    const dogs = listChores(db).filter((c) => c.name.toLowerCase() === 'feed the dog');
    expect(dogs).toEqual([mine]);
  });
});
