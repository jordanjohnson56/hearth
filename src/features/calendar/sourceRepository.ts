// Repository for calendar_source and calendar_source_secret: the only SQL
// about sources. The row mapper's query never touches the secret table, so
// a source read from here cannot carry the address; readSourceSecret is
// the one query that does, for the fetch path.
import type { Database } from 'better-sqlite3';
import { isPersonColor } from '../../core/personColor.js';
import type { PersonColor } from '../../core/personColor.js';
import { SecretUrl } from './secretUrl.js';
import type { FetchFailure } from './types.js';

export interface CalendarSource {
  id: number;
  label: string;
  color: PersonColor;
  fingerprint: string;
  createdAt: Date;
  lastAttemptAt: Date | null;
  lastSuccessAt: Date | null;
  lastError: FetchFailure | null;
  skippedCount: number;
}

export interface SourceInput {
  label: string;
  color: PersonColor;
  url: SecretUrl;
}

export type SourcePatch = Partial<SourceInput>;

/** The label is taken, ignoring case. */
export class DuplicateLabelError extends Error {
  override name = 'DuplicateLabelError';
  constructor() {
    super('Another calendar already has that label');
  }
}

interface SourceRow {
  id: number;
  label: string;
  color: string;
  url_fingerprint: string;
  created_at: number;
  last_attempt_at: number | null;
  last_success_at: number | null;
  last_error: string | null;
  skipped_count: number;
}

const COLUMNS =
  'id, label, color, url_fingerprint, created_at, last_attempt_at, last_success_at, last_error, skipped_count';

function toSource(row: SourceRow): CalendarSource {
  return {
    id: row.id,
    label: row.label,
    // Checked on the way in; a token gone from the palette is a code bug.
    color: row.color as PersonColor,
    fingerprint: row.url_fingerprint,
    createdAt: new Date(row.created_at),
    lastAttemptAt: row.last_attempt_at === null ? null : new Date(row.last_attempt_at),
    lastSuccessAt: row.last_success_at === null ? null : new Date(row.last_success_at),
    // Written only from FetchFailure values (recordFetchFailure); anything else is a code bug.
    lastError: row.last_error as FetchFailure | null,
    skippedCount: row.skipped_count,
  };
}

/** Every source, in the order they were created. */
export function listSources(db: Database): CalendarSource[] {
  const rows = db.prepare(`SELECT ${COLUMNS} FROM calendar_source ORDER BY id`).all() as SourceRow[];
  return rows.map(toSource);
}

export function getSource(db: Database, id: number): CalendarSource | undefined {
  const row = db.prepare(`SELECT ${COLUMNS} FROM calendar_source WHERE id = ?`).get(id) as
    | SourceRow
    | undefined;
  return row === undefined ? undefined : toSource(row);
}

/** Inserts the source and its secret together. Throws DuplicateLabelError. */
export function insertSource(db: Database, input: SourceInput, createdAt: Date): CalendarSource {
  if (!isPersonColor(input.color)) {
    throw new RangeError(`not a person color: ${JSON.stringify(input.color)}`);
  }
  return db.transaction(() => {
    const row = withLabelCheck(
      () =>
        db
          .prepare(
            `INSERT INTO calendar_source (label, color, url_fingerprint, created_at)
             VALUES (?, ?, ?, ?) RETURNING ${COLUMNS}`,
          )
          .get(input.label, input.color, input.url.fingerprint, createdAt.getTime()) as SourceRow,
    );
    db.prepare('INSERT INTO calendar_source_secret (source_id, url) VALUES (?, ?)').run(
      row.id,
      input.url.reveal(),
    );
    return toSource(row);
  })();
}

/**
 * Changes label, color and/or address. A new address also resets the fetch
 * status (the old results no longer describe this source). Returns the row,
 * or undefined when there is no such source. Throws DuplicateLabelError.
 */
export function updateSource(db: Database, id: number, patch: SourcePatch): CalendarSource | undefined {
  if (patch.color !== undefined && !isPersonColor(patch.color)) {
    throw new RangeError(`not a person color: ${JSON.stringify(patch.color)}`);
  }
  return db.transaction(() => {
    if (patch.label !== undefined) {
      withLabelCheck(() =>
        db.prepare('UPDATE calendar_source SET label = ? WHERE id = ?').run(patch.label, id),
      );
    }
    if (patch.color !== undefined) {
      db.prepare('UPDATE calendar_source SET color = ? WHERE id = ?').run(patch.color, id);
    }
    if (patch.url !== undefined) {
      db.prepare(
        `UPDATE calendar_source
         SET url_fingerprint = ?, last_attempt_at = NULL, last_success_at = NULL,
             last_error = NULL, skipped_count = 0
         WHERE id = ?`,
      ).run(patch.url.fingerprint, id);
      db.prepare('UPDATE calendar_source_secret SET url = ? WHERE source_id = ?').run(
        patch.url.reveal(),
        id,
      );
    }
    return getSource(db, id);
  })();
}

/** Deletes the source; its secret and events go with it (ON DELETE CASCADE). */
export function deleteSource(db: Database, id: number): boolean {
  return db.prepare('DELETE FROM calendar_source WHERE id = ?').run(id).changes === 1;
}

export function recordFetchSuccess(
  db: Database,
  id: number,
  at: Date,
  skippedCount: number,
): void {
  db.prepare(
    `UPDATE calendar_source
     SET last_attempt_at = ?, last_success_at = ?, last_error = NULL, skipped_count = ?
     WHERE id = ?`,
  ).run(at.getTime(), at.getTime(), skippedCount, id);
}

export function recordFetchFailure(db: Database, id: number, at: Date, error: FetchFailure): void {
  db.prepare('UPDATE calendar_source SET last_attempt_at = ?, last_error = ? WHERE id = ?').run(
    at.getTime(),
    error,
    id,
  );
}

/**
 * The address of one source, for the fetcher only. The only query that
 * reads calendar_source_secret.
 */
export function readSourceSecret(db: Database, id: number): SecretUrl | undefined {
  const row = db.prepare('SELECT url FROM calendar_source_secret WHERE source_id = ?').get(id) as
    | { url: string }
    | undefined;
  return row === undefined ? undefined : SecretUrl.parse(row.url);
}

function withLabelCheck<T>(write: () => T): T {
  try {
    return write();
  } catch (err) {
    if (isUniqueViolation(err, 'calendar_source.label')) throw new DuplicateLabelError();
    throw err;
  }
}

function isUniqueViolation(err: unknown, column: string): boolean {
  return (
    err instanceof Error &&
    (err as { code?: unknown }).code === 'SQLITE_CONSTRAINT_UNIQUE' &&
    err.message.includes(column)
  );
}
