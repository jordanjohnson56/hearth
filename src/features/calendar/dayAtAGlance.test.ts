import { describe, expect, it } from 'vitest';
import { stalenessLine, todaysEvents } from './dayAtAGlance.js';
import type { CalendarEventWire, EventsResponse } from './types.js';

const CHICAGO = 'America/Chicago';
// Friday 2026-10-23 14:00 CDT.
const NOON_ISH = new Date('2026-10-23T19:00:00Z');

const ADA = { id: 1, label: 'Ada', color: 'lake' } as const;
const LINUS = { id: 2, label: 'Linus', color: 'moss' } as const;

let nextId = 1;

function timed(title: string, start: string, end: string, sourceId = ADA.id): CalendarEventWire {
  return {
    id: nextId++,
    sourceId,
    uid: `${title}@cal.example`,
    recurrenceId: null,
    title,
    location: null,
    kind: 'timed',
    startAt: Date.parse(start),
    endAt: Date.parse(end),
  };
}

function allDay(title: string, startDate: string, endDate: string, sourceId = ADA.id): CalendarEventWire {
  return {
    id: nextId++,
    sourceId,
    uid: `${title}@cal.example`,
    recurrenceId: null,
    title,
    location: null,
    kind: 'allDay',
    startDate,
    endDate,
  };
}

function response(events: CalendarEventWire[]): EventsResponse {
  return { events, sources: [ADA, LINUS], newestSuccessAt: NOON_ISH.getTime() };
}

describe('todaysEvents', () => {
  it('lists all-day events first, then timed events by start', () => {
    const shown = todaysEvents(
      response([
        timed('Dentist', '2026-10-23T15:00:00-05:00', '2026-10-23T16:00:00-05:00'),
        allDay('No school', '2026-10-23', '2026-10-24'),
        timed('Breakfast', '2026-10-23T07:30:00-05:00', '2026-10-23T08:00:00-05:00'),
      ]),
      NOON_ISH,
      CHICAGO,
    );

    expect(shown.map((event) => event.title)).toEqual(['No school', 'Breakfast', 'Dentist']);
  });
});

describe('todaysEvents: which day an event belongs to', () => {
  const flight = timed('Late flight', '2026-10-23T21:00:00-05:00', '2026-10-24T01:00:00-05:00');
  const titles = (events: CalendarEventWire[], now: Date) =>
    todaysEvents(response(events), now, CHICAGO).map((event) => event.title);

  it('shows a timed event that crosses midnight on both local days', () => {
    expect(titles([flight], NOON_ISH)).toEqual(['Late flight']);
    const nextMorning = new Date('2026-10-24T15:00:00Z');
    expect(titles([flight], nextMorning)).toEqual(['Late flight']);
  });

  it('leaves out events on other days, judged in the configured zone', () => {
    // 2026-10-24 00:30 CDT is 05:30Z: the tomorrow of the Chicago wall, not of UTC.
    const tomorrowEarly = timed('Early run', '2026-10-24T00:30:00-05:00', '2026-10-24T01:00:00-05:00');
    const yesterday = allDay('Yesterday', '2026-10-22', '2026-10-23');
    expect(titles([tomorrowEarly, yesterday], NOON_ISH)).toEqual([]);
  });

  it('does not put an event ending exactly at midnight on the next day', () => {
    const party = timed('Party', '2026-10-22T20:00:00-05:00', '2026-10-23T00:00:00-05:00');
    expect(titles([party], NOON_ISH)).toEqual([]);
  });

  it('shows a multi-day all-day event on every day up to its exclusive end', () => {
    const camp = allDay('Camp', '2026-10-21', '2026-10-24');
    expect(titles([camp], NOON_ISH)).toEqual(['Camp']);
    expect(titles([camp], new Date('2026-10-24T15:00:00Z'))).toEqual([]);
  });
});

describe('todaysEvents: what is over', () => {
  it('marks a timed event over once its end instant has passed, ending exactly now included', () => {
    const at14 = new Date('2026-10-23T19:00:00Z');
    const shown = todaysEvents(
      response([
        timed('Breakfast', '2026-10-23T07:30:00-05:00', '2026-10-23T08:00:00-05:00'),
        timed('Lunch', '2026-10-23T13:00:00-05:00', '2026-10-23T14:00:00-05:00'),
        timed('Call', '2026-10-23T13:30:00-05:00', '2026-10-23T14:30:00-05:00'),
        timed('Dentist', '2026-10-23T15:00:00-05:00', '2026-10-23T16:00:00-05:00'),
      ]),
      at14,
      CHICAGO,
    );

    expect(shown.map((event) => [event.title, event.over])).toEqual([
      ['Breakfast', true],
      ['Lunch', true],
      ['Call', false],
      ['Dentist', false],
    ]);
  });

  it('never dims an all-day event on a day it covers', () => {
    const lateEvening = new Date('2026-10-24T04:30:00Z'); // 23:30 CDT on the 23rd
    const [event] = todaysEvents(response([allDay('No school', '2026-10-23', '2026-10-24')]), lateEvening, CHICAGO);
    expect(event?.over).toBe(false);
  });
});

describe('todaysEvents: how a timed span relates to today', () => {
  const flight = timed('Late flight', '2026-10-23T21:00:00-05:00', '2026-10-24T01:00:00-05:00');
  const retreat = timed('Retreat', '2026-10-22T18:00:00-05:00', '2026-10-24T12:00:00-05:00');
  const dentist = timed('Dentist', '2026-10-23T15:00:00-05:00', '2026-10-23T16:00:00-05:00');
  const timingOf = (event: CalendarEventWire, now: Date) =>
    todaysEvents(response([event]), now, CHICAGO)[0]?.timing;

  it('is within today for an ordinary event, with its instants for formatting', () => {
    expect(timingOf(dentist, NOON_ISH)).toEqual({
      kind: 'timed',
      span: 'within',
      startAt: Date.parse('2026-10-23T15:00:00-05:00'),
      endAt: Date.parse('2026-10-23T16:00:00-05:00'),
    });
  });

  it('starts today on the first day it touches and ends today on the last', () => {
    const onToday = timingOf(flight, NOON_ISH);
    expect(onToday?.kind === 'timed' && onToday.span).toBe('startsToday');
    const onTomorrow = timingOf(flight, new Date('2026-10-24T15:00:00Z'));
    expect(onTomorrow?.kind === 'timed' && onTomorrow.span).toBe('endsToday');
  });

  it('covers today in the middle of a longer span', () => {
    const t = timingOf(retreat, NOON_ISH);
    expect(t?.kind === 'timed' && t.span).toBe('coversToday');
  });

  it('is all-day for an all-day event', () => {
    expect(timingOf(allDay('No school', '2026-10-23', '2026-10-24'), NOON_ISH)).toEqual({ kind: 'allDay' });
  });
});

describe('stalenessLine', () => {
  const now = new Date('2026-10-23T19:00:00Z');
  const ago = (ms: number) => now.getTime() - ms;
  const MINUTE = 60_000;
  const HOUR = 60 * MINUTE;

  it('says nothing before any fetch has succeeded, and nothing while fresh', () => {
    expect(stalenessLine(null, now)).toBeUndefined();
    expect(stalenessLine(ago(30 * MINUTE), now)).toBeUndefined();
    expect(stalenessLine(ago(60 * MINUTE), now)).toBeUndefined();
  });

  it('counts whole hours once older than 60 minutes', () => {
    expect(stalenessLine(ago(60 * MINUTE + 1), now)).toBe('Calendar updated 1 hour ago');
    expect(stalenessLine(ago(90 * MINUTE), now)).toBe('Calendar updated 1 hour ago');
    expect(stalenessLine(ago(2 * HOUR), now)).toBe('Calendar updated 2 hours ago');
    expect(stalenessLine(ago(23 * HOUR + 59 * MINUTE), now)).toBe('Calendar updated 23 hours ago');
  });

  it('counts whole days from 24 hours on', () => {
    expect(stalenessLine(ago(24 * HOUR), now)).toBe('Calendar updated 1 day ago');
    expect(stalenessLine(ago(71 * HOUR), now)).toBe('Calendar updated 2 days ago');
    expect(stalenessLine(ago(72 * HOUR), now)).toBe('Calendar updated 3 days ago');
  });
});
