// Builders for the events route's wire shape, for the tile and month-grid
// tests. Ids count up from 1 per process unless given; the title defaults
// to `Event <id>` and the source to 1.
import type { CalendarEventWire } from '../../src/features/calendar/types.js';

export interface WireEventFields {
  id?: number;
  sourceId?: number;
  title?: string;
  location?: string | null;
}

let nextId = 1;

function base(fields: WireEventFields) {
  const id = fields.id ?? nextId++;
  return {
    id,
    sourceId: fields.sourceId ?? 1,
    uid: `u${String(id)}@cal.example`,
    recurrenceId: null,
    title: fields.title ?? `Event ${String(id)}`,
    location: fields.location ?? null,
  };
}

/** A timed event from `start` to `end` (anything Date.parse reads). */
export function timed(start: string, end: string, fields: WireEventFields = {}): CalendarEventWire {
  return { ...base(fields), kind: 'timed', startAt: Date.parse(start), endAt: Date.parse(end) };
}

/** An all-day event over the local dates `startDate` up to the exclusive `endDate`. */
export function allDay(startDate: string, endDate: string, fields: WireEventFields = {}): CalendarEventWire {
  return { ...base(fields), kind: 'allDay', startDate, endDate };
}
