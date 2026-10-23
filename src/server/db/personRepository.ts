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

/** The fields an admin may change; avatar and icon are not among them. */
export type PersonPatch = Partial<PersonInput>;

/** The display name is taken by someone else, ignoring case. */
export class DuplicateDisplayNameError extends Error {
  override name = 'DuplicateDisplayNameError';
  constructor() {
    super('Someone already has that name');
  }
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

export function getPerson(db: Database, id: number): Person | undefined {
  const row = db.prepare(`SELECT ${COLUMNS} FROM person WHERE id = ?`).get(id) as PersonRow | undefined;
  return row === undefined ? undefined : toPerson(row);
}

/** Inserts a new person without avatar or icon. Throws DuplicateDisplayNameError. */
export function insertPerson(db: Database, input: PersonInput): Person {
  checkColor(input.color);
  const row = withNameCheck(
    () =>
      db
        .prepare(`INSERT INTO person (display_name, color) VALUES (?, ?) RETURNING ${COLUMNS}`)
        .get(input.displayName, input.color) as PersonRow,
  );
  return toPerson(row);
}

/**
 * Changes the display name and/or color; the id, avatar and icon are kept.
 * Returns the row, or undefined when there is no such person. Throws
 * DuplicateDisplayNameError when the new name is someone else's.
 */
export function updatePerson(db: Database, id: number, patch: PersonPatch): Person | undefined {
  if (patch.color !== undefined) checkColor(patch.color);
  const row = withNameCheck(
    () =>
      db
        .prepare(
          `UPDATE person
           SET display_name = coalesce(?, display_name), color = coalesce(?, color)
           WHERE id = ?
           RETURNING ${COLUMNS}`,
        )
        .get(patch.displayName ?? null, patch.color ?? null, id) as PersonRow | undefined,
  );
  return row === undefined ? undefined : toPerson(row);
}

/**
 * Inserts the person, or, when someone with the same display name (ignoring
 * case) exists, updates that row's spelling and color in place. The id,
 * avatar and icon of an existing person are kept.
 */
export function upsertPersonByDisplayName(db: Database, input: PersonInput): Person {
  checkColor(input.color);
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

/** A token outside the palette is a caller bug; the router checks input first. */
function checkColor(color: string): void {
  if (!isPersonColor(color)) throw new RangeError(`not a person color: ${JSON.stringify(color)}`);
}

function withNameCheck<T>(write: () => T): T {
  try {
    return write();
  } catch (err) {
    if (
      err instanceof Error &&
      (err as { code?: unknown }).code === 'SQLITE_CONSTRAINT_UNIQUE' &&
      err.message.includes('person.display_name')
    ) {
      throw new DuplicateDisplayNameError();
    }
    throw err;
  }
}
