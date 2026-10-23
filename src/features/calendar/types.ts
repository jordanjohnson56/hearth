// Types shared by the calendar feature's server and client halves. Type
// declarations only, so the client can `import type` from here without
// pulling server code into the bundle.
import type { PersonColor } from '../../core/personColor.js';
import type { LocalDate } from '../../core/time.js';

/**
 * When an event happens. A timed event is an instant range; an all-day
 * event is a local-date range whose end is exclusive, as in iCalendar
 * (a one-day event on the 25th has startDate 25, endDate 26).
 */
export type EventTiming =
  | { kind: 'timed'; startAt: Date; endAt: Date }
  | { kind: 'allDay'; startDate: LocalDate; endDate: LocalDate };

/** One normalized entry from a feed, before it is tied to a source. */
export type ParsedEvent = {
  uid: string;
  /**
   * Which occurrence of a recurring event this is: its RECURRENCE-ID as the
   * feed would write it (an override's, when one replaces the occurrence).
   * Null for a single event. With the uid it tells occurrences apart.
   */
  recurrenceId: string | null;
  title: string;
  location: string | null;
} & EventTiming;

/** A stored occurrence: a ParsedEvent that belongs to one source. */
export type CalendarEvent = ParsedEvent & { sourceId: number };

/** A fetch failure, as stored on the source row. */
export type FetchFailure = 'timeout' | `http ${number}` | 'not-ics' | 'too-large' | 'network';

// Wire shapes (docs/adr/0004): instants are epoch-millisecond numbers,
// local dates are YYYY-MM-DD strings.

export type EventTimingWire =
  | { kind: 'timed'; startAt: number; endAt: number }
  | { kind: 'allDay'; startDate: string; endDate: string };

export type CalendarEventWire = {
  id: number;
  sourceId: number;
  uid: string;
  recurrenceId: string | null;
  title: string;
  location: string | null;
} & EventTimingWire;

/** What the legend needs. */
export interface SourceSummaryWire {
  id: number;
  label: string;
  color: PersonColor;
}

/** GET /api/calendar/events */
export interface EventsResponse {
  events: CalendarEventWire[];
  sources: SourceSummaryWire[];
  /**
   * The newest successful fetch across every source, or null when none has
   * succeeded yet. The spec's field name was `oldestSuccessAt`; its
   * definition of staleness (newest success older than 60 minutes) is what
   * this carries, hence the name.
   */
  newestSuccessAt: number | null;
}

/** A source as admin sees it: every column except the address. */
export interface SourceWire {
  id: number;
  label: string;
  color: PersonColor;
  /** Host plus a short hash of the address; the address itself is never sent. */
  fingerprint: string;
  createdAt: number;
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  lastError: FetchFailure | null;
  /** VEVENTs in the last successful fetch that could not be read. */
  skippedCount: number;
}

/** GET /api/calendar/sources */
export interface SourcesResponse {
  sources: SourceWire[];
}
