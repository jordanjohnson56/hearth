// Helpers over the events route's wire shapes, shared by the Day at a
// glance tile and the month page. Client-safe: local dates come from
// src/core/localDateText.ts, never src/core/time.ts.
import { addDays, localDateOf } from '../../core/localDateText.js';
import type { CalendarEventWire, EventsResponse, SourceSummaryWire } from './types.js';

/** An event with its legend entry attached. */
export type SourcedEvent = CalendarEventWire & { source: SourceSummaryWire };

/**
 * The response's events, each with its source from the legend. An event
 * whose source is absent from the legend is dropped, on the tile and the
 * page alike: it cannot be coloured or labelled.
 */
export function withSources(response: EventsResponse): SourcedEvent[] {
  const sources = new Map(response.sources.map((source) => [source.id, source]));
  return response.events.flatMap((event) => {
    const source = sources.get(event.sourceId);
    return source === undefined ? [] : [{ ...event, source }];
  });
}

/**
 * The first and last local dates an event occupies in `zone`. An all-day
 * end is an exclusive date; a timed end is an exclusive instant, so the
 * last day holds `endAt - 1 ms` and ending exactly at midnight does not
 * touch the next day.
 */
export function localDaysOf(event: CalendarEventWire, zone: string): { first: string; last: string } {
  if (event.kind === 'allDay') return { first: event.startDate, last: addDays(event.endDate, -1) };
  const lastInstant = Math.max(event.startAt, event.endAt - 1);
  return { first: localDateOf(new Date(event.startAt), zone), last: localDateOf(new Date(lastInstant), zone) };
}
