// Repository for the person table: the only module that holds SQL about
// people. Display names are unique ignoring case (person_display_name index).
import type { Database } from 'better-sqlite3';
import { isPersonColor } from '../../core/personColor.js';
import type { PersonColor } from '../../core/personColor.js';

export interface Person {
  id: number;
  displayName: string;
  /** A palette token; the client theme maps it to a color per theme. */
  color: PersonColor;
  /** Relative to DATA_DIR, or null when the person has no avatar. */
  avatarPath: string | null;
  /** A monochrome icon token (kebab-case), or null when none is chosen. */
  icon: string | null;
}

export interface PersonInput {
  displayName: string;
  color: PersonColor;
}

interface PersonRow {
  id: number;
  display_name: string;
  color: string;
  avatar_path: string | null;
  icon: string | null;
}

const COLUMNS = 'id, display_name, color, avatar_path, icon';

function toPerson(row: PersonRow): Person {
  return {
    id: row.id,
    displayName: row.display_name,
    // A token removed from the palette after it was stored is a code bug,
    // not bad input, so it is not checked again on the way out.
    color: row.color as PersonColor,
    avatarPath: row.avatar_path,
    icon: row.icon,
  };
}

/** Everyone, in the order they were created. */
export function listPeople(db: Database): Person[] {
  const rows = db.prepare(`SELECT ${COLUMNS} FROM person ORDER BY id`).all() as PersonRow[];
  return rows.map(toPerson);
}

/**
 * Inserts the person, or, when someone with the same display name (ignoring
 * case) exists, updates that row's spelling and color in place. The id,
 * avatar and icon of an existing person are kept.
 */
export function upsertPersonByDisplayName(db: Database, input: PersonInput): Person {
  if (!isPersonColor(input.color)) {
    throw new RangeError(`not a person color: ${JSON.stringify(input.color)}`);
  }
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
