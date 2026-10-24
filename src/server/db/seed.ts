// The demo seed: the fictional family Ada, Linus, Marie and Grace. These are
// the only person names allowed anywhere in the repository (DESIGN section 3).
// Seeding is idempotent: each person is upserted by display name. Each
// feature then adds its own demo data through ServerFeature.seed.
import type { Database } from 'better-sqlite3';
import type { FeatureId, ServerFeature } from '../../features/types.js';
import { prepareDatabase } from './database.js';
import type { MigrationRef } from './migrate.js';
import { listPeople, upsertPersonByDisplayName } from './personRepository.js';
import type { Person, PersonInput } from './personRepository.js';

/** Distinct colors, no avatars (the client falls back to a colored initial). */
export const FICTIONAL_FAMILY: readonly PersonInput[] = [
  { displayName: 'Ada', color: 'ember' },
  { displayName: 'Linus', color: 'lake' },
  { displayName: 'Marie', color: 'moss' },
  { displayName: 'Grace', color: 'plum' },
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
  /** What each feature with a seed seeded, in registry order. */
  features: { id: FeatureId; seeded: string[] }[];
}

/**
 * What `npm run seed` does: opens DATA_DIR/hearth.db, applies pending
 * migrations exactly as a server boot would (so the seed never runs against
 * an older schema), seeds the family, then each feature's demo data, and
 * closes the handle. A failed migration throws before anything is seeded.
 * `zone` is the configured zone, for features whose demo data counts from
 * the seed day.
 */
export function seedDataDir(
  dataDir: string,
  features: readonly ServerFeature[],
  now: Date,
  zone: string,
): SeedResult {
  const { db, applied } = prepareDatabase(dataDir, features, now);
  try {
    const people = seedFamily(db);
    const seeded = features.flatMap((feature) =>
      feature.seed === undefined ? [] : [{ id: feature.id, seeded: feature.seed(db, now, zone) }],
    );
    return { applied, people, features: seeded };
  } finally {
    db.close();
  }
}
