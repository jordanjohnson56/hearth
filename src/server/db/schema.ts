// The core schema (people, settings, seasons) and the full, ordered list of
// migration sets the server applies at boot. The migration tracking table is
// not here: the runner's repository creates it (migrationRepository.ts).
//
// Conventions for every table, core and feature (docs/adr/0002):
// - STRICT tables, so a value of the wrong type is an error, not a silent
//   coercion.
// - Instants are INTEGER epoch milliseconds (UTC) in columns named `*_at`.
// - Inclusive local dates (seasons) are `YYYY-MM-DD` TEXT in columns named
//   `*_date`; `date(x) IS x` rejects any other shape and impossible dates.
//
// Applied migrations are never edited. Fix forward with a new one.
import type { Migration, ServerFeature } from '../../features/types.js';
import type { MigrationSet } from './migrate.js';

export const coreMigrations: readonly Migration[] = [
  {
    id: 1,
    name: 'create person, setting and season',
    sql: `
      CREATE TABLE person (
        id           INTEGER PRIMARY KEY,
        display_name TEXT NOT NULL
                     CHECK (display_name <> '' AND display_name = trim(display_name)),
        -- Lowercase #rrggbb, one canonical spelling per color.
        color        TEXT NOT NULL
                     CHECK (color GLOB '#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'),
        -- Relative to DATA_DIR; never absolute, never climbing out of it.
        avatar_path  TEXT
                     CHECK (avatar_path IS NULL OR (
                       avatar_path <> ''
                       AND substr(avatar_path, 1, 1) <> '/'
                       AND instr(avatar_path, '..') = 0
                     )),
        -- A token naming one of the app's monochrome icons (kebab-case), not
        -- a file. Which tokens exist is checked in code, so adding an icon
        -- needs no migration. Shown when there is no photo avatar.
        icon         TEXT
                     CHECK (icon IS NULL OR (
                       icon GLOB '[a-z0-9]*'
                       AND NOT icon GLOB '*[^a-z0-9-]*'
                     ))
      ) STRICT;

      -- The leaderboard tells people apart by name.
      CREATE UNIQUE INDEX person_display_name ON person (display_name COLLATE NOCASE);

      -- Each key's value format belongs to the code that reads that key.
      CREATE TABLE setting (
        key   TEXT NOT NULL PRIMARY KEY CHECK (key <> ''),
        value TEXT NOT NULL
      ) STRICT, WITHOUT ROWID;

      -- start_date and end_date are inclusive local dates in the configured
      -- zone. Overlap between seasons is not prevented here.
      CREATE TABLE season (
        id         INTEGER PRIMARY KEY,
        name       TEXT NOT NULL CHECK (name <> '' AND name = trim(name)),
        start_date TEXT NOT NULL CHECK (date(start_date) IS start_date),
        end_date   TEXT NOT NULL CHECK (date(end_date) IS end_date),
        reward     TEXT NOT NULL CHECK (reward <> ''),
        CHECK (end_date >= start_date)
      ) STRICT;
    `,
  },
];

/**
 * Every migration set in the order the runner applies them: core first, then
 * each feature's own set in the order given (the server registry's order).
 */
export function migrationSets(features: readonly ServerFeature[]): MigrationSet[] {
  return [
    { scope: 'core', migrations: coreMigrations },
    ...features.map((feature) => ({ scope: feature.id, migrations: feature.migrations })),
  ];
}
