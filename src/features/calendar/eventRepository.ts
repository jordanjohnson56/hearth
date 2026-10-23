// Repository for calendar_event: the only SQL about stored occurrences.
// Rows are the timed/all-day union flattened into nullable column pairs;
// the mapper rebuilds the union from `kind`.
import type { Database } from 'better-sqlite3';
import type { LocalDate } from '../../core/time.js';
import type { CalendarEvent, ParsedEvent } from './types.js';

/** A stored occurrence. */
export type StoredEvent = CalendarEvent & { id: number };

interface EventRow {
  id: number;
  source_id: number;
  uid: string;
  recurrence_id: string | null;
  kind: 'timed' | 'all_day';
  start_at: number | null;
  end_at: number | null;
  start_date: string | null;
  end_date: string | null;
  title: string;
  location: string | null;
}

const COLUMNS =
  'id, source_id, uid, recurrence_id, kind, start_at, end_at, start_date, end_date, title, location';

function toEvent(row: EventRow): StoredEvent {
  const base = {
    id: row.id,
    sourceId: row.source_id,
    uid: row.uid,
    recurrenceId: row.recurrence_id,
    title: row.title,
    location: row.location,
  };
  // The table CHECK guarantees the pair matching `kind` is non-null; a row
  // that breaks it is corrupt and is refused rather than read as a 1970 event.
  if (row.kind === 'timed') {
    if (row.start_at === null || row.end_at === null) throw corruptRow(row);
    return { ...base, kind: 'timed', startAt: new Date(row.start_at), endAt: new Date(row.end_at) };
  }
  if (row.start_date === null || row.end_date === null) throw corruptRow(row);
  return { ...base, kind: 'allDay', startDate: row.start_date as LocalDate, endDate: row.end_date as LocalDate };
}

/** Ids only: the title or location could be anything the feed sent. */
function corruptRow(row: EventRow): Error {
  return new Error(`calendar_event row ${row.id} of source ${row.source_id} is ${row.kind} without its start and end`);
}

/**
 * Replaces every row of `sourceId` with `events`. Not a transaction by
 * itself: the caller wraps it with the status update so both land or neither.
 */
export function replaceEvents(db: Database, sourceId: number, events: readonly ParsedEvent[]): void {
  db.prepare('DELETE FROM calendar_event WHERE source_id = ?').run(sourceId);
  const insert = db.prepare(
    `INSERT INTO calendar_event
       (source_id, uid, recurrence_id, kind, start_at, end_at, start_date, end_date, title, location)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const event of events) {
    if (event.kind === 'timed') {
      insert.run(sourceId, event.uid, event.recurrenceId, 'timed', event.startAt.getTime(), event.endAt.getTime(), null, null, event.title, event.location);
    } else {
      insert.run(sourceId, event.uid, event.recurrenceId, 'all_day', null, null, event.startDate, event.endDate, event.title, event.location);
    }
  }
}

/** Every stored occurrence of one source, in a stable order. */
export function listEventsOf(db: Database, sourceId: number): StoredEvent[] {
  const rows = db
    .prepare(`SELECT ${COLUMNS} FROM calendar_event WHERE source_id = ? ORDER BY id`)
    .all(sourceId) as EventRow[];
  return rows.map(toEvent);
}

export function deleteEvents(db: Database, sourceId: number): void {
  db.prepare('DELETE FROM calendar_event WHERE source_id = ?').run(sourceId);
}

export interface EventRange {
  /** The instants the local-date range covers, end exclusive. */
  start: Date;
  end: Date;
  /** The same range as local dates, `toExclusive` being the day after the last. */
  from: LocalDate;
  toExclusive: LocalDate;
}

/**
 * Every occurrence overlapping the range: all-day rows by date, then timed
 * rows by instant. A zero-length timed event counts when its instant is in
 * the range.
 */
export function listEventsBetween(db: Database, range: EventRange): StoredEvent[] {
  const allDay = db
    .prepare(
      `SELECT ${COLUMNS} FROM calendar_event
       WHERE kind = 'all_day' AND start_date < ? AND end_date > ?
       ORDER BY start_date, end_date, id`,
    )
    .all(range.toExclusive, range.from) as EventRow[];
  const timed = db
    .prepare(
      `SELECT ${COLUMNS} FROM calendar_event
       WHERE kind = 'timed' AND start_at < ? AND (end_at > ? OR start_at >= ?)
       ORDER BY start_at, end_at, id`,
    )
    .all(range.end.getTime(), range.start.getTime(), range.start.getTime()) as EventRow[];
  return [...allDay, ...timed].map(toEvent);
}
