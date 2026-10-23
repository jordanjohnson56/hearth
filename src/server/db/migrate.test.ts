import { describe, expect, it } from 'vitest';
import { tempDatabase } from '../../../test/helpers/sqlite.js';
import { appliedMigrations, MigrationError, MigrationPlanError, runMigrations } from './migrate.js';
import type { MigrationSet } from './migrate.js';

const BOOT = new Date('2026-10-23T14:00:00.000Z');

const createPerson = {
  id: 1,
  name: 'create person',
  sql: 'CREATE TABLE person (id INTEGER PRIMARY KEY) STRICT',
};
const createSeason = {
  id: 2,
  name: 'create season',
  sql: 'CREATE TABLE season (id INTEGER PRIMARY KEY) STRICT',
};
const createChore = {
  id: 1,
  name: 'create chore',
  sql: 'CREATE TABLE chore (id INTEGER PRIMARY KEY) STRICT',
};
const coreSet: MigrationSet = { scope: 'core', migrations: [createPerson, createSeason] };
const choresSet: MigrationSet = { scope: 'chores', migrations: [createChore] };
const sets: readonly MigrationSet[] = [coreSet, choresSet];

type Db = ReturnType<typeof tempDatabase>['db'];

function tableNames(db: Db): string[] {
  return db
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name")
    .pluck()
    .all() as string[];
}

describe('runMigrations', () => {
  it('applies every migration of every set to a fresh database and records each one', () => {
    const { db } = tempDatabase();

    const result = runMigrations(db, sets, BOOT);

    expect(result.applied).toEqual([
      { scope: 'core', id: 1, name: 'create person' },
      { scope: 'core', id: 2, name: 'create season' },
      { scope: 'chores', id: 1, name: 'create chore' },
    ]);
    expect(tableNames(db)).toEqual(expect.arrayContaining(['person', 'season', 'chore']));
    expect(appliedMigrations(db)).toEqual([
      { scope: 'core', id: 1, name: 'create person', appliedAt: BOOT },
      { scope: 'core', id: 2, name: 'create season', appliedAt: BOOT },
      { scope: 'chores', id: 1, name: 'create chore', appliedAt: BOOT },
    ]);
  });

  it('does nothing on a second run against an up-to-date database', () => {
    const { db } = tempDatabase();
    runMigrations(db, sets, BOOT);
    const before = appliedMigrations(db);

    const result = runMigrations(db, sets, new Date('2026-10-24T09:00:00.000Z'));

    expect(result.applied).toEqual([]);
    expect(appliedMigrations(db)).toEqual(before);
  });

  it('allows the same id in different scopes', () => {
    const { db } = tempDatabase();
    const sameIds: readonly MigrationSet[] = [
      { scope: 'core', migrations: [{ id: 1, name: 'core one', sql: 'CREATE TABLE a (x INTEGER) STRICT' }] },
      { scope: 'calendar', migrations: [{ id: 1, name: 'calendar one', sql: 'CREATE TABLE b (x INTEGER) STRICT' }] },
      { scope: 'chores', migrations: [{ id: 1, name: 'chores one', sql: 'CREATE TABLE c (x INTEGER) STRICT' }] },
    ];

    runMigrations(db, sameIds, BOOT);

    expect(appliedMigrations(db).map(({ scope, id }) => `${scope}#${String(id)}`)).toEqual([
      'core#1',
      'calendar#1',
      'chores#1',
    ]);
  });

  it('applies newly added migrations on a later run, and only those', () => {
    const { db } = tempDatabase();
    runMigrations(db, sets, BOOT);
    const later = new Date('2026-11-02T08:00:00.000Z');
    const grown: readonly MigrationSet[] = [
      coreSet,
      {
        scope: 'chores',
        migrations: [
          createChore,
          { id: 2, name: 'add chore points', sql: 'ALTER TABLE chore ADD COLUMN points INTEGER' },
        ],
      },
    ];

    const result = runMigrations(db, grown, later);

    expect(result.applied).toEqual([{ scope: 'chores', id: 2, name: 'add chore points' }]);
    expect(appliedMigrations(db).at(-1)).toEqual({
      scope: 'chores',
      id: 2,
      name: 'add chore points',
      appliedAt: later,
    });
  });

  describe('refuses to run, changing nothing, when the sets do not match the code’s rules', () => {
    const create = (table: string) => `CREATE TABLE ${table} (x INTEGER) STRICT`;

    it.each([
      [
        'a set that does not start at 1',
        [{ scope: 'core', migrations: [{ id: 2, name: 'two', sql: create('a') }] }],
        'core: migration ids must run 1, 2, 3… in order; found 2 where 1 belongs',
      ],
      [
        'a gap in a set',
        [
          {
            scope: 'chores',
            migrations: [
              { id: 1, name: 'one', sql: create('a') },
              { id: 3, name: 'three', sql: create('b') },
            ],
          },
        ],
        'chores: migration ids must run 1, 2, 3… in order; found 3 where 2 belongs',
      ],
      [
        'a set listed twice',
        [
          { scope: 'core', migrations: [{ id: 1, name: 'one', sql: create('a') }] },
          { scope: 'core', migrations: [{ id: 1, name: 'one', sql: create('b') }] },
        ],
        'core: migration set listed more than once',
      ],
    ] satisfies [string, MigrationSet[], string][])('%s', (_label, invalid, message) => {
      const { db } = tempDatabase();

      expect(() => runMigrations(db, invalid, BOOT)).toThrow(
        new MigrationPlanError(message),
      );
      expect(tableNames(db)).toEqual([]);
    });

    it('an applied migration that is missing from the code (a database newer than this build)', () => {
      const { db } = tempDatabase();
      runMigrations(db, sets, BOOT);
      const older: readonly MigrationSet[] = [{ scope: 'core', migrations: [createPerson] }, choresSet];

      expect(() => runMigrations(db, older, BOOT)).toThrow(
        new MigrationPlanError(
          'core#2 (create season) is recorded as applied but is not in this build; applied migrations are never removed or renumbered',
        ),
      );
    });

    it('an applied migration whose name changed in the code (renumbered or edited)', () => {
      const { db } = tempDatabase();
      runMigrations(db, sets, BOOT);
      const renumbered: readonly MigrationSet[] = [
        {
          scope: 'core',
          migrations: [
            createPerson,
            { id: 2, name: 'create setting', sql: create('setting') },
            { id: 3, name: 'create season', sql: 'CREATE TABLE season (id INTEGER PRIMARY KEY) STRICT' },
          ],
        },
        choresSet,
      ];

      expect(() => runMigrations(db, renumbered, BOOT)).toThrow(
        new MigrationPlanError(
          'core#2 is recorded as applied with the name "create season" but this build calls it "create setting"; applied migrations are never removed or renumbered',
        ),
      );
      expect(tableNames(db)).not.toContain('setting');
    });
  });

  describe('when a migration fails', () => {
    // Its first statement succeeds, so a rollback has something to undo.
    const broken: readonly MigrationSet[] = [
      {
        scope: 'core',
        migrations: [
          { id: 1, name: 'create person', sql: 'CREATE TABLE person (id INTEGER PRIMARY KEY) STRICT' },
          {
            id: 2,
            name: 'create season',
            sql: `CREATE TABLE season (id INTEGER PRIMARY KEY) STRICT;
                  INSERT INTO no_such_table VALUES (1);`,
          },
          { id: 3, name: 'create setting', sql: 'CREATE TABLE setting (key TEXT PRIMARY KEY) STRICT' },
        ],
      },
      {
        scope: 'chores',
        migrations: [
          { id: 1, name: 'create chore', sql: 'CREATE TABLE chore (id INTEGER PRIMARY KEY) STRICT' },
        ],
      },
    ];

    it('throws a MigrationError naming the migration, with the SQLite error as its cause', () => {
      const { db } = tempDatabase();

      let thrown: unknown;
      try {
        runMigrations(db, broken, BOOT);
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(MigrationError);
      expect(thrown).toMatchObject({
        scope: 'core',
        migrationId: 2,
        migrationName: 'create season',
        message: 'migration core#2 (create season) failed: no such table: no_such_table',
        cause: expect.objectContaining({ code: 'SQLITE_ERROR' }) as unknown,
      });
    });

    it('rolls back its schema change and records nothing for it, while earlier migrations stay applied', () => {
      const { db } = tempDatabase();

      expect(() => runMigrations(db, broken, BOOT)).toThrow(MigrationError);

      expect(tableNames(db)).toContain('person');
      expect(tableNames(db)).not.toContain('season');
      expect(appliedMigrations(db)).toEqual([
        { scope: 'core', id: 1, name: 'create person', appliedAt: BOOT },
      ]);
    });

    it('stops there: nothing after it runs, in its own set or later ones', () => {
      const { db } = tempDatabase();

      expect(() => runMigrations(db, broken, BOOT)).toThrow(MigrationError);

      expect(tableNames(db)).not.toContain('setting');
      expect(tableNames(db)).not.toContain('chore');
    });

    it('leaves an up-to-date database exactly as it was when the broken migration is the only pending one', () => {
      const { db } = tempDatabase();
      runMigrations(db, sets, BOOT);
      const schemaBefore = db.prepare('SELECT type, name, sql FROM sqlite_schema ORDER BY name').all();
      const withBrokenNext: readonly MigrationSet[] = [
        coreSet,
        {
          scope: 'chores',
          migrations: [
            createChore,
            {
              id: 2,
              name: 'add chore points',
              sql: `ALTER TABLE chore ADD COLUMN points INTEGER;
                    SELECT no_such_function();`,
            },
          ],
        },
      ];

      expect(() => runMigrations(db, withBrokenNext, new Date('2026-10-24T09:00:00.000Z'))).toThrow(
        MigrationError,
      );

      expect(db.prepare('SELECT type, name, sql FROM sqlite_schema ORDER BY name').all()).toEqual(
        schemaBefore,
      );
      expect(appliedMigrations(db)).toHaveLength(3);
    });
  });
});
