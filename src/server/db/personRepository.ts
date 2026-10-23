// Repository for the person table: the only module that holds SQL about
// people. Display names are unique ignoring case (person_display_name index).
import type { Database } from 'better-sqlite3';

export interface Person {
  id: number;
  displayName: string;
  /** Lowercase `#rrggbb`. */
  color: string;
  /** Relative to DATA_DIR, or null when the person has no avatar. */
  avatarPath: string | null;
}

export interface PersonInput {
  displayName: string;
  color: string;
}

interface PersonRow {
  id: number;
  display_name: string;
  color: string;
  avatar_path: string | null;
}

const COLUMNS = 'id, display_name, color, avatar_path';

function toPerson(row: PersonRow): Person {
  return {
    id: row.id,
    displayName: row.display_name,
    color: row.color,
    avatarPath: row.avatar_path,
  };
}

/** Everyone, in the order they were created. */
export function listPeople(db: Database): Person[] {
  const rows = db.prepare(`SELECT ${COLUMNS} FROM person ORDER BY id`).all() as PersonRow[];
  return rows.map(toPerson);
}

/**
 * Inserts the person, or, when someone with the same display name (ignoring
 * case) exists, updates that row's spelling and color in place. The id and
 * avatar of an existing person are kept.
 */
export function upsertPersonByDisplayName(db: Database, input: PersonInput): Person {
  const row = db
    .prepare(
      `INSERT INTO person (display_name, color) VALUES (?, ?)
       ON CONFLICT (display_name COLLATE NOCASE)
       DO UPDATE SET display_name = excluded.display_name, color = excluded.color
       RETURNING ${COLUMNS}`,
    )
    .get(input.displayName, input.color) as PersonRow;
  return toPerson(row);
}
