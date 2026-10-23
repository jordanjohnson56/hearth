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
 * The occurrences of one UID that fall in the window: a single event, or a
 * recurring master expanded with its EXDATEs and RECURRENCE-ID overrides.
 * The exceptions are only the group's own, so two series with an override
 * at the same time never borrow each other's. Overrides without a master
 * (orphans) are shown as single events, as Google Calendar does.
 */
function occurrencesOf(group: UidGroup, window: InstantWindow): Occurrence[] {
  const master = group.masters[0];
  if (master === undefined) {
    return group.exceptions.flatMap((orphan) => singleOccurrence(group.uid, orphan, window));
  }
  if (isCancelled(master)) return [];
  const event = new ICAL.Event(master, { exceptions: group.exceptions });
  if (!event.isRecurring()) return singleOccurrence(group.uid, master, window);
  const occurrences: Occurrence[] = [];
  const visited = new Set<ICAL.Component>();
  const iterator = event.iterator(expansionStart(event, window));
  let count = 0;
  let time: ICAL.Time | undefined;
  while ((time = iterator.next() as ICAL.Time | undefined)) {
    // An unbounded rule never completes: stop once the instance itself
    // starts after the window. The cap is for a rule that is wrong rather
    // than long (a per-minute rule): the whole event is skipped and counted.
    if (count++ >= MAX_OCCURRENCES) throw new Error('too many occurrences');
    if (startsAfter(time, window)) break;
    const details: OccurrenceDetails = event.getOccurrenceDetails(time);
    visited.add(details.item.component);
    const found = occurrence(group.uid, details.item, details.recurrenceId, details.startDate, details.endDate, window);
    if (keep(found, window)) occurrences.push(found);
  }
  // An override moves its instance in time, possibly from outside the scan
  // (after the window, or before an expansion start) to inside it.
  for (const exception of group.exceptions) {
    if (!visited.has(exception)) occurrences.push(...singleOccurrence(group.uid, exception, window));
  }
  return occurrences;
}

/**
 * What getOccurrenceDetails returns: the instance's own time, and the
 * override (with its moved start and end) when one replaces it, else the
 * master. Declared here because the package's typing of it does not
 * resolve under NodeNext.
 */
interface OccurrenceDetails {
  recurrenceId: ICAL.Time;
  item: ICAL.Event;
  startDate: ICAL.Time;
  endDate: ICAL.Time;
}

/** Iterations per master before the event is given up on. */
const MAX_OCCURRENCES = 10_000;

/**
 * Where to start scanning a DAILY or WEEKLY rule with no COUNT: a whole
 * number of periods after DTSTART, two periods before the window, so an
 * event that has run for decades is not scanned from its first day.
 * `iterator(start)` re-bases the rule on `start`, so the weekday and wall
 * time must be DTSTART's own; a COUNT would restart; MONTHLY and YEARLY
 * rules depend on the month day, so they scan from DTSTART.
 */
function expansionStart(event: ICAL.Event, window: InstantWindow): ICAL.Time | undefined {
  const rule: unknown = event.component.getFirstPropertyValue('rrule');
  if (!(rule instanceof ICAL.Recur) || rule.count !== null) return undefined;
  if (rule.freq !== 'DAILY' && rule.freq !== 'WEEKLY') return undefined;
  const start = event.startDate as ICAL.Time | null;
  if (start === null) return undefined;
  const periodDays = (rule.freq === 'WEEKLY' ? 7 : 1) * rule.interval;
  const periodMs = periodDays * 86_400_000;
  const periods = Math.floor((window.start.getTime() - instantOf(start, window.zone).getTime()) / periodMs) - 2;
  if (periods <= 0) return undefined;
  const from = start.clone();
  from.day += periods * periodDays;
  return from;
}

/** Whether the instance at `time` begins after the window ends. */
function startsAfter(time: ICAL.Time, window: InstantWindow): boolean {
  if (time.isDate) return dateOf(time) >= window.toExclusive;
  return instantOf(time, window.zone) >= window.end;
}

/** A VEVENT on its own (not recurring, or an override shown by itself). */
function singleOccurrence(uid: string, vevent: ICAL.Component, window: InstantWindow): Occurrence[] {
  if (isCancelled(vevent)) return [];
  const event = new ICAL.Event(vevent, { exceptions: [] });
  // Reading startDate/endDate is what throws for a malformed DTSTART or
  // DURATION. The typings say startDate is always a Time; without DTSTART
  // it is null at runtime.
  const start = event.startDate as ICAL.Time | null;
  if (start === null) throw new Error('VEVENT without DTSTART');
  const recurrenceId = event.recurrenceId as ICAL.Time | null;
  const found = occurrence(uid, event, recurrenceId, start, event.endDate, window);
  return keep(found, window) ? [found] : [];
}

function occurrence(
  uid: string,
  item: ICAL.Event,
  recurrenceId: ICAL.Time | null,
  start: ICAL.Time,
  end: ICAL.Time,
  window: InstantWindow,
): Occurrence {
  return { uid, recurrenceId, item, start, end, zone: window.zone };
}

/** An instance counts when it is not cancelled and overlaps the window. */
function keep(occurrence: Occurrence, window: InstantWindow): boolean {
  return !isCancelled(occurrence.item.component) && inWindow(timingOf(occurrence), window);
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
