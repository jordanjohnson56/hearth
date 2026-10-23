// The demo seed: the fictional family Ada, Linus, Marie and Grace. These are
// the only person names allowed anywhere in the repository (DESIGN section 3).
// Seeding is idempotent: each person is upserted by display name.
import type { Database } from 'better-sqlite3';
import type { ServerFeature } from '../../features/types.js';
import { prepareDatabase } from './database.js';
import type { MigrationRef } from './migrate.js';
import { listPeople, upsertPersonByDisplayName } from './personRepository.js';
import type { Person, PersonInput } from './personRepository.js';

/** Distinct colors, no avatars (the client falls back to a colored initial). */
export const FICTIONAL_FAMILY: readonly PersonInput[] = [
  { displayName: 'Ada', color: '#c2410c' },
  { displayName: 'Linus', color: '#1d4ed8' },
  { displayName: 'Marie', color: '#15803d' },
  { displayName: 'Grace', color: '#7e22ce' },
];

/**
 * Upserts the fictional family into an already migrated database, in one
 * transaction. Returns everyone in the person table afterwards.
 */
export function seedFamily(db: Database): Person[] {
  db.transaction(() => {
    for (const person of FICTIONAL_FAMILY) upsertPersonByDisplayName(db, person);
  })();
  return listPeople(db);
}

export interface SeedResult {
  /** Migrations this run applied before seeding; empty when already up to date. */
  applied: MigrationRef[];
  people: Person[];
}

/**
 * What `npm run seed` does: opens DATA_DIR/hearth.db, applies pending
 * migrations exactly as a server boot would (so the seed never runs against
 * an older schema), seeds the family and closes the handle. A failed
 * migration throws before anything is seeded.
 */
export function seedDataDir(
  dataDir: string,
  features: readonly ServerFeature[],
  now: Date,
): SeedResult {
  const { db, applied } = prepareDatabase(dataDir, features, now);
  try {
    return { applied, people: seedFamily(db) };
  } finally {
    db.close();
  }
}
