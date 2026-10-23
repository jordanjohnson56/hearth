import { describe, expect, it } from 'vitest';
import { tempDatabase } from '../../../test/helpers/sqlite.js';
import { runMigrations } from './migrate.js';
import type { PersonColor } from '../../core/personColor.js';
import { listPeople, upsertPersonByDisplayName } from './personRepository.js';
import { migrationSets } from './schema.js';

function migratedDatabase() {
  const { db } = tempDatabase();
  runMigrations(db, migrationSets([]), new Date('2026-10-23T14:00:00.000Z'));
  return db;
}

describe('person repository', () => {
  it('lists no one in an empty database', () => {
    expect(listPeople(migratedDatabase())).toEqual([]);
  });

  it('inserts a new person without an avatar and returns the stored row', () => {
    const db = migratedDatabase();

    const ada = upsertPersonByDisplayName(db, { displayName: 'Ada', color: 'lake' });

    expect(ada).toEqual({ id: expect.any(Number) as unknown, displayName: 'Ada', color: 'lake', avatarPath: null, icon: null });
    expect(listPeople(db)).toEqual([ada]);
  });

  it('updates the existing person whose name matches ignoring case, keeping the id', () => {
    const db = migratedDatabase();
    const first = upsertPersonByDisplayName(db, { displayName: 'linus', color: 'slate' });

    const second = upsertPersonByDisplayName(db, { displayName: 'Linus', color: 'lake' });

    expect(second).toEqual({ id: first.id, displayName: 'Linus', color: 'lake', avatarPath: null, icon: null });
    expect(listPeople(db)).toEqual([second]);
  });

  it('lists people in the order they were created', () => {
    const db = migratedDatabase();
    upsertPersonByDisplayName(db, { displayName: 'Marie', color: 'moss' });
    upsertPersonByDisplayName(db, { displayName: 'Grace', color: 'sun' });
    upsertPersonByDisplayName(db, { displayName: 'Marie', color: 'teal' });

    expect(listPeople(db).map((p) => p.displayName)).toEqual(['Marie', 'Grace']);
  });

  it('rejects a color that is not a palette token, without writing anything', () => {
    const db = migratedDatabase();

    expect(() => upsertPersonByDisplayName(db, { displayName: 'Ada', color: 'tomato' as PersonColor })).toThrow(
      /not a person color: "tomato"/,
    );
    expect(listPeople(db)).toEqual([]);
  });
});
