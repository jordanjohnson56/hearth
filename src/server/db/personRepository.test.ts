import { describe, expect, it } from 'vitest';
import { tempDatabase } from '../../../test/helpers/sqlite.js';
import { runMigrations } from './migrate.js';
import type { PersonColor } from '../../core/personColor.js';
import { DuplicateDisplayNameError, insertPerson, listPeople, updatePerson, upsertPersonByDisplayName } from './personRepository.js';
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

  it('updates a person\'s name and color, keeping the id, avatar and icon', () => {
    const db = migratedDatabase();
    const ada = upsertPersonByDisplayName(db, { displayName: 'Ada', color: 'ember' });
    // No repository call sets these yet (avatar upload and icons come later).
    db.prepare("UPDATE person SET avatar_path = 'avatars/ada.webp', icon = 'fox' WHERE id = ?").run(ada.id);

    const renamed = updatePerson(db, ada.id, { displayName: 'Ada L', color: 'lake' });

    expect(renamed).toEqual({ id: ada.id, displayName: 'Ada L', color: 'lake', avatarPath: 'avatars/ada.webp', icon: 'fox' });
    expect(listPeople(db)).toEqual([renamed]);
  });

  it('changes only the fields a patch names', () => {
    const db = migratedDatabase();
    const linus = upsertPersonByDisplayName(db, { displayName: 'Linus', color: 'lake' });

    expect(updatePerson(db, linus.id, { color: 'moss' })).toMatchObject({ displayName: 'Linus', color: 'moss' });
    expect(updatePerson(db, linus.id, { displayName: 'linus' })).toMatchObject({ displayName: 'linus', color: 'moss' });
  });

  it('answers undefined for an unknown id', () => {
    expect(updatePerson(migratedDatabase(), 999, { color: 'moss' })).toBeUndefined();
  });

  it('refuses a rename onto another person\'s name ignoring case, changing nothing', () => {
    const db = migratedDatabase();
    upsertPersonByDisplayName(db, { displayName: 'Marie', color: 'moss' });
    const grace = upsertPersonByDisplayName(db, { displayName: 'Grace', color: 'plum' });

    expect(() => updatePerson(db, grace.id, { displayName: 'MARIE', color: 'sun' })).toThrow(DuplicateDisplayNameError);
    expect(listPeople(db).map((p) => [p.displayName, p.color])).toEqual([
      ['Marie', 'moss'],
      ['Grace', 'plum'],
    ]);
  });

  it('inserts a new person, refusing a name taken ignoring case', () => {
    const db = migratedDatabase();
    const marie = insertPerson(db, { displayName: 'Marie', color: 'moss' });

    expect(marie).toEqual({ id: expect.any(Number) as unknown, displayName: 'Marie', color: 'moss', avatarPath: null, icon: null });
    expect(() => insertPerson(db, { displayName: 'marie', color: 'sun' })).toThrow(DuplicateDisplayNameError);
    expect(listPeople(db)).toEqual([marie]);
  });

  it('rejects an update to a color outside the palette', () => {
    const db = migratedDatabase();
    const ada = upsertPersonByDisplayName(db, { displayName: 'Ada', color: 'ember' });

    expect(() => updatePerson(db, ada.id, { color: 'tomato' as PersonColor })).toThrow(/not a person color/);
    expect(listPeople(db)).toEqual([ada]);
  });
});
