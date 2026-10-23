// The change digest: one hash over a source's normalized event set, so a
// poll can tell "the feed changed" from "the feed was fetched again". Pure.
import { createHash } from 'node:crypto';
import type { CalendarEvent } from './types.js';

/**
 * A stable SHA-256 hex digest of `events` as a set: the same events in any
 * order give the same digest, and any change to a source, uid, recurrence
 * id, kind, time, title or location changes it. A stored row's id is not
 * part of it (rows are replaced wholesale on every poll).
 */
export function digestOf(events: readonly CalendarEvent[]): string {
  const keys = events.map(keyOf).sort();
  return createHash('sha256').update(JSON.stringify(keys)).digest('hex');
}

function keyOf(event: CalendarEvent): string {
  const timing =
    event.kind === 'timed'
      ? [event.startAt.getTime(), event.endAt.getTime()]
      : [event.startDate, event.endDate];
  return JSON.stringify([
    event.sourceId,
    event.uid,
    event.recurrenceId,
    event.kind,
    ...timing,
    event.title,
    event.location,
  ]);
}
