import { describe, expect, it } from 'vitest';
import { isPersonColor } from '../../core/personColor.js';
import { serverFeatureList } from '../../features/registry.server.js';
import { tempDatabase } from '../../../test/helpers/sqlite.js';
import { testConfig } from '../../../test/helpers/app.js';
import { openDatabase } from './database.js';
import { appliedMigrations, runMigrations } from './migrate.js';
import { listPeople, upsertPersonByDisplayName } from './personRepository.js';
import { migrationSets } from './schema.js';
import { seedDataDir, seedFamily } from './seed.js';

const NOW = new Date('2026-10-23T14:00:00.000Z');

function migratedDatabase() {
  const { db } = tempDatabase();
  runMigrations(db, migrationSets(serverFeatureList), NOW);
  return db;
}

describe('seedFamily', () => {
  it('creates the fictional family: Ada, Linus, Marie and Grace, each with a distinct color and no avatar', () => {
    const db = migratedDatabase();

    seedFamily(db);

    const people = listPeople(db);
    expect(people.map((p) => p.displayName)).toEqual(['Ada', 'Linus', 'Marie', 'Grace']);
    expect(new Set(people.map((p) => p.color)).size).toBe(4);
    expect(people.every((p) => isPersonColor(p.color))).toBe(true);
    expect(people.map((p) => p.avatarPath)).toEqual([null, null, null, null]);
  });

  it('is idempotent: seeding twice leaves exactly four people, with the same ids', () => {
    const db = migratedDatabase();

    seedFamily(db);
    const first = listPeople(db);
    seedFamily(db);

    expect(listPeople(db)).toEqual(first);
    expect(listPeople(db)).toHaveLength(4);
  });

  it('matches existing people by display name ignoring case, and restores the seed spelling and color', () => {
    const db = migratedDatabase();
    const changed = upsertPersonByDisplayName(db, { displayName: 'ada', color: 'slate' });

    seedFamily(db);

    const people = listPeople(db);
    expect(people).toHaveLength(4);
    const ada = people.find((p) => p.id === changed.id);
    expect(ada?.displayName).toBe('Ada');
    expect(ada?.color).not.toBe('slate');
  });
});

describe('seedDataDir', () => {
  it('applies pending migrations to a fresh DATA_DIR before seeding, and closes its handle', () => {
    const { dataDir } = testConfig();

    const result = seedDataDir(dataDir, serverFeatureList, NOW);

    expect(result.applied.length).toBeGreaterThan(0);
    expect(result.people.map((p) => p.displayName)).toEqual(['Ada', 'Linus', 'Marie', 'Grace']);
    const db = openDatabase(dataDir);
    try {
      expect(appliedMigrations(db)).toHaveLength(result.applied.length);
      expect(listPeople(db)).toEqual(result.people);
    } finally {
      db.close();
    }
  });

  it('on a second run applies nothing and still leaves exactly four people', () => {
    const { dataDir } = testConfig();
    seedDataDir(dataDir, serverFeatureList, NOW);

    const again = seedDataDir(dataDir, serverFeatureList, NOW);

    expect(again.applied).toEqual([]);
    expect(again.people).toHaveLength(4);
  });
});
