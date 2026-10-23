import { describe, expect, it } from 'vitest';
import type { ServerFeature } from '../../features/types.js';
import { tempDatabase } from '../../../test/helpers/sqlite.js';
import { appliedMigrations, runMigrations } from './migrate.js';
import { coreMigrations, migrationSets } from './schema.js';

const BOOT = new Date('2026-10-23T14:00:00.000Z');

describe('migrationSets', () => {
  it('puts the core set first, then each feature in the order given', () => {
    const chores = { id: 'chores', name: 'Chores', migrations: [] } satisfies ServerFeature;
    const calendar = { id: 'calendar', name: 'Calendar', migrations: [] } satisfies ServerFeature;

    expect(migrationSets([chores, calendar]).map((set) => set.scope)).toEqual([
      'core',
      'chores',
      'calendar',
    ]);
  });

  it('runs core migrations before a feature migration that depends on a core table', () => {
    const { db } = tempDatabase();
    // Fails unless core's person table already exists.
    const chores = {
      id: 'chores',
      name: 'Chores',
      migrations: [
        {
          id: 1,
          name: 'create completion',
          sql: `CREATE TABLE completion (
                  id INTEGER PRIMARY KEY,
                  person_id INTEGER NOT NULL REFERENCES person (id)
                ) STRICT;
                CREATE VIEW completion_by_person AS
                  SELECT person.display_name, count(*) AS n
                  FROM completion JOIN person ON person.id = completion.person_id
                  GROUP BY person.id;
                SELECT * FROM completion_by_person;`,
        },
      ],
    } satisfies ServerFeature;

    runMigrations(db, migrationSets([chores]), BOOT);

    const scopes = appliedMigrations(db).map((record) => record.scope);
    expect(scopes.indexOf('chores')).toBeGreaterThan(scopes.lastIndexOf('core'));
  });
});

describe('the core migration set', () => {
  it('applies cleanly to an empty database', () => {
    const { db } = tempDatabase();

    const result = runMigrations(db, [{ scope: 'core', migrations: coreMigrations }], BOOT);

    expect(result.applied.map((ref) => ref.id)).toEqual(coreMigrations.map((m) => m.id));
    expect(
      db
        .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name")
        .pluck()
        .all(),
    ).toEqual(['migration', 'person', 'season', 'setting']);
  });

  function coreDatabase() {
    const { db } = tempDatabase();
    runMigrations(db, [{ scope: 'core', migrations: coreMigrations }], BOOT);
    return db;
  }

  describe('person', () => {
    const insert = (db: ReturnType<typeof coreDatabase>, row: Record<string, unknown>) =>
      db
        .prepare(
          'INSERT INTO person (display_name, color, avatar_path, icon) VALUES (@display_name, @color, @avatar_path, @icon)',
        )
        .run({ display_name: 'Ada', color: 'lake', avatar_path: null, icon: null, ...row });

    it('accepts a person with or without an avatar', () => {
      const db = coreDatabase();
      insert(db, {});
      insert(db, { display_name: 'Linus', avatar_path: 'avatars/linus.png' });

      expect(db.prepare('SELECT display_name, color, avatar_path FROM person ORDER BY id').all()).toEqual([
        { display_name: 'Ada', color: 'lake', avatar_path: null },
        { display_name: 'Linus', color: 'lake', avatar_path: 'avatars/linus.png' },
      ]);
    });

    it.each([
      ['an empty name', { display_name: '' }],
      ['a name with surrounding spaces', { display_name: ' Ada' }],
      ['a missing name', { display_name: null }],
      ['a hex color instead of a palette token', { color: '#3a7bd5' }],
      ['an uppercase color token', { color: 'Lake' }],
      ['an empty color', { color: '' }],
      ['an absolute avatar path', { avatar_path: '/etc/passwd' }],
      ['an avatar path that climbs out of DATA_DIR', { avatar_path: 'avatars/../../hearth.db' }],
      ['an empty avatar path', { avatar_path: '' }],
      ['an empty icon', { icon: '' }],
      ['an icon with uppercase letters', { icon: 'Fox' }],
      ['an icon that looks like a path', { icon: 'icons/fox.svg' }],
      ['an icon that starts with a hyphen', { icon: '-fox' }],
    ])('rejects %s', (_label, row) => {
      const db = coreDatabase();
      expect(() => insert(db, row)).toThrow(/constraint failed/);
    });

    it('accepts a person with an icon token, with or without a photo avatar', () => {
      const db = coreDatabase();
      insert(db, { icon: 'fox' });
      insert(db, { display_name: 'Grace', icon: 'ice-cream-2', avatar_path: 'avatars/grace.png' });

      expect(db.prepare('SELECT display_name, icon FROM person ORDER BY id').all()).toEqual([
        { display_name: 'Ada', icon: 'fox' },
        { display_name: 'Grace', icon: 'ice-cream-2' },
      ]);
    });

    it('rejects a second person whose name differs only in case', () => {
      const db = coreDatabase();
      insert(db, { display_name: 'Marie' });
      expect(() => insert(db, { display_name: 'marie' })).toThrow(/UNIQUE constraint failed/);
    });
  });

  describe('setting', () => {
    it('holds one text value per key', () => {
      const db = coreDatabase();
      db.prepare('INSERT INTO setting (key, value) VALUES (?, ?)').run('theme.dark_from', '19:30');

      expect(() =>
        db.prepare('INSERT INTO setting (key, value) VALUES (?, ?)').run('theme.dark_from', '20:00'),
      ).toThrow(/UNIQUE constraint failed/);
      expect(() => db.prepare('INSERT INTO setting (key, value) VALUES (?, ?)').run('', 'x')).toThrow(
        /CHECK constraint failed/,
      );
    });
  });

  describe('season', () => {
    const insert = (db: ReturnType<typeof coreDatabase>, row: Record<string, unknown>) =>
      db
        .prepare(
          'INSERT INTO season (name, start_date, end_date, reward) VALUES (@name, @start_date, @end_date, @reward)',
        )
        .run({
          name: 'Autumn',
          start_date: '2026-09-01',
          end_date: '2026-11-30',
          reward: 'Picks the Friday film',
          ...row,
        });

    it('accepts inclusive local date ranges, including a single day and a leap day', () => {
      const db = coreDatabase();
      insert(db, {});
      insert(db, { name: 'One day', start_date: '2028-02-29', end_date: '2028-02-29' });

      expect(db.prepare('SELECT count(*) FROM season').pluck().get()).toBe(2);
    });

    it.each([
      ['an end before its start', { start_date: '2026-11-30', end_date: '2026-09-01' }],
      ['a date without leading zeros', { start_date: '2026-9-01' }],
      ['an impossible date', { end_date: '2026-02-30' }],
      ['a leap day in a common year', { end_date: '2027-02-29' }],
      ['a date with a time', { start_date: '2026-09-01T00:00' }],
      ['an instant instead of a date', { start_date: Date.UTC(2026, 8, 1) }],
      ['an empty name', { name: '' }],
      ['an empty reward', { reward: '' }],
    ])('rejects %s', (_label, row) => {
      const db = coreDatabase();
      expect(() => insert(db, row)).toThrow(/CHECK constraint failed/);
    });
  });
});
