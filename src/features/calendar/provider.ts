// The CalendarProvider: feed text in, Hearth's own events out. This is the
// only module that imports ical.js; nothing of its types crosses this file's
// exports (docs/adr/0003).
import ICAL from 'ical.js';
import { addDays, localDateRangeToInstants, wallTimeToInstant } from '../../core/time.js';
import type { LocalDate } from '../../core/time.js';
import type { EventTiming, ParsedEvent } from './types.js';

/** The body is not an iCalendar feed (HTML, plain text, truncated, empty). */
export class NotIcsError extends Error {
  override name = 'NotIcsError';
  constructor() {
    super('body is not an iCalendar feed');
  }
}

export interface ParseOptions {
  /** Inclusive local dates: occurrences outside are dropped. */
  from: LocalDate;
  to: LocalDate;
  /** The configured zone: floating times and the window are read in it. */
  zone: string;
}

export interface ParsedFeed {
  events: ParsedEvent[];
  /** VEVENTs that could not be read and were left out. */
  skipped: number;
}

/**
 * Parses an iCalendar feed into normalized events within the window.
 * Throws NotIcsError when the text is not a feed at all; a single bad
 * VEVENT is skipped and counted instead.
 */
export function parseFeed(text: string, options: ParseOptions): ParsedFeed {
  const calendar = parseCalendar(text);
  const window = instantWindow(options);
  const events: ParsedEvent[] = [];
  let skipped = 0;
  for (const group of groupByUid(calendar.getAllSubcomponents('vevent'))) {
    try {
      events.push(...occurrencesOf(group, window).map(toParsedEvent));
    } catch {
      // Whatever ical.js threw may quote the feed; the count is all that leaves.
      skipped += 1;
    }
  }
  return { events, skipped };
}

function parseCalendar(text: string): ICAL.Component {
  let jcal: unknown;
  try {
    jcal = ICAL.parse(text);
  } catch {
    throw new NotIcsError();
  }
  // ICAL.parse returns [] for an empty string and a bare component for a
  // feed without a VCALENDAR wrapper; neither is a feed.
  if (!Array.isArray(jcal) || jcal[0] !== 'vcalendar') throw new NotIcsError();
  // VEVENTs stay attached to this root: that is how a TZID resolves against
  // the feed's own VTIMEZONE (ical.js 2.x needs no registration).
  return new ICAL.Component(jcal as [string, unknown[], unknown[]]);
}

/** The VEVENTs sharing one UID: the master and its RECURRENCE-ID overrides. */
interface UidGroup {
  uid: string;
  masters: ICAL.Component[];
  exceptions: ICAL.Component[];
}

function groupByUid(vevents: ICAL.Component[]): UidGroup[] {
  const groups = new Map<string, UidGroup>();
  vevents.forEach((vevent, index) => {
    const raw: unknown = vevent.getFirstPropertyValue('uid');
    const uid = typeof raw === 'string' && raw !== '' ? raw : `no-uid:${String(index)}`;
    let group = groups.get(uid);
    if (!group) {
      group = { uid, masters: [], exceptions: [] };
      groups.set(uid, group);
    }
    (vevent.hasProperty('recurrence-id') ? group.exceptions : group.masters).push(vevent);
  });
  return [...groups.values()];
}

interface InstantWindow {
  from: LocalDate;
  /** Exclusive: the day after the window's last date. */
  toExclusive: LocalDate;
  start: Date;
  end: Date;
  zone: string;
}

function instantWindow(options: ParseOptions): InstantWindow {
  const { start, end } = localDateRangeToInstants(options.from, options.to, options.zone);
  return { from: options.from, toExclusive: addDays(options.to, 1), start, end, zone: options.zone };
}

/** One instance of an event, still in ical.js terms. */
interface Occurrence {
  uid: string;
  recurrenceId: ICAL.Time | null;
  item: ICAL.Event;
  start: ICAL.Time;
  end: ICAL.Time;
  zone: string;
}

/**
 * The occurrences of one UID that fall in the window. The seam for
 * recurrence (#18): a recurring master is where RRULE/RDATE expansion with
 * `group.exceptions` goes; until then it is skipped and counted. A missing
 * master with orphan overrides is also left to #18.
 */
function occurrencesOf(group: UidGroup, window: InstantWindow): Occurrence[] {
  const master = group.masters[0];
  if (master === undefined) throw new Error('override without a master');
  const event = new ICAL.Event(master, { exceptions: [] });
  if (event.isRecurring()) throw new Error('recurrence expansion not implemented');
  if (isCancelled(master)) return [];
  // Reading startDate/endDate is what throws for a malformed DTSTART or
  // DURATION. The typings say startDate is always a Time; without DTSTART
  // it is null at runtime.
  const start = event.startDate as ICAL.Time | null;
  if (start === null) throw new Error('VEVENT without DTSTART');
  const occurrence: Occurrence = {
    uid: group.uid,
    recurrenceId: null,
    item: event,
    start,
    end: event.endDate,
    zone: window.zone,
  };
  return inWindow(timingOf(occurrence), window) ? [occurrence] : [];
}

function isCancelled(vevent: ICAL.Component): boolean {
  const status: unknown = vevent.getFirstPropertyValue('status');
  return typeof status === 'string' && status.toUpperCase() === 'CANCELLED';
}

function toParsedEvent(occurrence: Occurrence): ParsedEvent {
  const summary: unknown = occurrence.item.summary;
  const location: unknown = occurrence.item.location;
  return {
    uid: occurrence.uid,
    recurrenceId: occurrence.recurrenceId === null ? null : occurrence.recurrenceId.toString(),
    title: typeof summary === 'string' ? summary : '',
    location: typeof location === 'string' && location !== '' ? location : null,
    ...timingOf(occurrence),
  };
}

function timingOf(occurrence: Occurrence): EventTiming {
  const { start, end, zone } = occurrence;
  if (start.isDate) {
    const startDate = dateOf(start);
    // An all-day DTEND is exclusive; absent, ical.js already adds one day.
    // An end on or before the start (a feed bug) still gets one day.
    const endDate = dateOf(end);
    return { kind: 'allDay', startDate, endDate: endDate > startDate ? endDate : addDays(startDate, 1) };
  }
  const startAt = instantOf(start, zone);
  const endAt = instantOf(end, zone);
  return { kind: 'timed', startAt, endAt: endAt > startAt ? endAt : startAt };
}

function dateOf(time: ICAL.Time): LocalDate {
  return `${pad(time.year, 4)}-${pad(time.month, 2)}-${pad(time.day, 2)}` as LocalDate;
}

/**
 * The instant a DATE-TIME names. A value with a resolved zone (UTC or a
 * TZID the feed defines) converts through ical.js; a floating value, which
 * includes a TZID the feed does not define, is a wall time in the
 * configured zone. Never toJSDate(): for floating values it reads the
 * process zone.
 */
function instantOf(time: ICAL.Time, zone: string): Date {
  if (time.zone === ICAL.Timezone.localTimezone) {
    return wallTimeToInstant(time.year, time.month, time.day, time.hour, time.minute, time.second, zone);
  }
  return new Date(time.toUnixTime() * 1000);
}

function inWindow(timing: EventTiming, window: InstantWindow): boolean {
  if (timing.kind === 'allDay') {
    return timing.startDate < window.toExclusive && timing.endDate > window.from;
  }
  // A zero-length event has no interior to overlap with: it is in if its
  // instant is.
  return timing.startAt < window.end && (timing.endAt > window.start || timing.startAt >= window.start);
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}
