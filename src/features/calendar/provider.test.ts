import { describe, expect, it } from 'vitest';
import { icalFixture } from '../../../test/helpers/ical.js';
import type { LocalDate } from '../../core/time.js';
import { NotIcsError, parseFeed } from './provider.js';

const CHICAGO = 'America/Chicago';
/** The poll window for now = 2026-10-23 in Chicago. */
const WINDOW = { from: '2026-07-01' as LocalDate, to: '2027-10-31' as LocalDate, zone: CHICAGO };

function byUid(text: string, options = WINDOW) {
  const { events, skipped } = parseFeed(text, options);
  return { skipped, uids: events.map((e) => e.uid), event: (uid: string) => events.find((e) => e.uid === uid) };
}

describe('parseFeed: single events', () => {
  it('normalizes a timed event in the feed VTIMEZONE and an all-day event', () => {
    const { events, skipped } = parseFeed(icalFixture('single-events'), WINDOW);

    expect(skipped).toBe(0);
    // 09:00 CDT (UTC-5) on 2026-10-24 is 14:00Z; the all-day end is exclusive.
    expect(events).toEqual([
      {
        uid: 'dentist@cal.example',
        recurrenceId: null,
        title: 'Ada dentist',
        location: 'Oak Street Dental',
        kind: 'timed',
        startAt: new Date('2026-10-24T14:00:00Z'),
        endAt: new Date('2026-10-24T15:30:00Z'),
      },
      {
        uid: 'no-school@cal.example',
        recurrenceId: null,
        title: 'Linus no school',
        location: null,
        kind: 'allDay',
        startDate: '2026-10-25',
        endDate: '2026-10-26',
      },
    ]);
  });

  it('keeps a UTC event as the instant it names, so 21:00-01:00 Chicago spans two local days', () => {
    const { event } = byUid(icalFixture('edge-cases'));
    expect(event('late-flight@cal.example')).toMatchObject({
      kind: 'timed',
      startAt: new Date('2026-10-24T02:00:00Z'),
      endAt: new Date('2026-10-24T06:00:00Z'),
    });
  });

  it('keeps an all-day event across a month boundary as one date range', () => {
    const { event } = byUid(icalFixture('edge-cases'));
    expect(event('camp@cal.example')).toMatchObject({
      kind: 'allDay',
      startDate: '2026-10-30',
      endDate: '2026-11-03',
    });
  });

  it('ends a timed event with no DTEND or DURATION when it starts', () => {
    const { event } = byUid(icalFixture('edge-cases'));
    expect(event('no-end@cal.example')).toMatchObject({
      startAt: new Date('2026-11-05T18:00:00Z'),
      endAt: new Date('2026-11-05T18:00:00Z'),
    });
  });

  it('gives an all-day event with no DTEND one day', () => {
    const { event } = byUid(icalFixture('edge-cases'));
    expect(event('all-day-no-end@cal.example')).toMatchObject({
      startDate: '2026-11-10',
      endDate: '2026-11-11',
    });
  });

  it('reads a floating time in the configured zone, ignoring X-WR-TIMEZONE', () => {
    // 18:00 CST (UTC-6) is 00:00Z the next day; the fixture's calendar-level
    // X-WR-TIMEZONE names Paris and must not win.
    const paris = byUid(icalFixture('single-events'));
    expect(paris.skipped).toBe(0);
    const { event } = byUid(icalFixture('edge-cases'));
    expect(event('floating@cal.example')).toMatchObject({
      startAt: new Date('2026-11-13T00:00:00Z'),
      endAt: new Date('2026-11-13T01:00:00Z'),
    });
    const tokyo = byUid(icalFixture('edge-cases'), { ...WINDOW, zone: 'Asia/Tokyo' });
    expect(tokyo.event('floating@cal.example')).toMatchObject({
      startAt: new Date('2026-11-12T09:00:00Z'),
    });
  });

  it('treats a TZID the feed does not define as floating (configured zone)', () => {
    const { event } = byUid(icalFixture('edge-cases'));
    expect(event('unknown-tzid@cal.example')).toMatchObject({
      startAt: new Date('2026-11-13T14:00:00Z'),
      endAt: new Date('2026-11-13T15:00:00Z'),
    });
  });

  it('applies DURATION when there is no DTEND', () => {
    const { event } = byUid(icalFixture('edge-cases'));
    expect(event('duration@cal.example')).toMatchObject({
      startAt: new Date('2026-11-14T16:00:00Z'),
      endAt: new Date('2026-11-14T16:45:00Z'),
    });
  });

  it('drops a cancelled event', () => {
    expect(byUid(icalFixture('edge-cases')).uids).not.toContain('cancelled@cal.example');
  });

  it('skips and counts a VEVENT that cannot be read, keeping the rest', () => {
    const { skipped, uids } = byUid(icalFixture('edge-cases'));
    expect(skipped).toBe(2);
    expect(uids).not.toContain('broken-start@cal.example');
    expect(uids).not.toContain('broken-duration@cal.example');
    expect(uids).toContain('untitled@cal.example');
  });

  it('gives an event without SUMMARY an empty title', () => {
    expect(byUid(icalFixture('edge-cases')).event('untitled@cal.example')?.title).toBe('');
  });

  it('returns no events and no skips for an empty but valid feed', () => {
    expect(parseFeed(icalFixture('empty'), WINDOW)).toEqual({ events: [], skipped: 0 });
  });
});

describe('parseFeed: recurrence', () => {
  it('expands a weekly rule into one occurrence per week in the window, each carrying its recurrence id', () => {
    const window = { from: '2026-02-23' as LocalDate, to: '2026-03-15' as LocalDate, zone: CHICAGO };

    const { events, skipped } = parseFeed(icalFixture('rrule-weekly-dst'), window);

    expect(skipped).toBe(0);
    expect(events).toEqual([
      {
        uid: 'weekly@cal.example',
        recurrenceId: '2026-02-23T09:00:00',
        title: 'Grace weekly swim',
        location: null,
        kind: 'timed',
        startAt: new Date('2026-02-23T15:00:00Z'),
        endAt: new Date('2026-02-23T16:00:00Z'),
      },
      expect.objectContaining({ recurrenceId: '2026-03-02T09:00:00', startAt: new Date('2026-03-02T15:00:00Z') }),
      expect.objectContaining({ recurrenceId: '2026-03-09T09:00:00', startAt: new Date('2026-03-09T14:00:00Z') }),
    ]);
  });
});

describe('parseFeed: the window', () => {
  it('keeps what overlaps the window and drops what ends before it starts or starts after it ends', () => {
    const { uids } = byUid(icalFixture('window-edges'));
    expect(uids.sort()).toEqual(
      [
        'all-day-first-window-day@cal.example',
        'all-day-straddles-start@cal.example',
        'timed-crosses-start@cal.example',
        'timed-last-window-day@cal.example',
        'all-day-last-window-day@cal.example',
      ].sort(),
    );
  });

  it('is evaluated in the given zone', () => {
    // In Tokyo (UTC+9) the window starts 14 hours before Chicago's, so the
    // event that ended exactly at Chicago's window start now overlaps it.
    const { uids } = byUid(icalFixture('window-edges'), { ...WINDOW, zone: 'Asia/Tokyo' });
    expect(uids).toContain('timed-ends-at-start@cal.example');
  });
});

describe('parseFeed: not iCalendar', () => {
  it.each([
    ['an HTML page', icalFixture('html-page')],
    ['plain text', 'hello world'],
    ['an empty body', ''],
    ['a truncated feed', icalFixture('empty').replace('END:VCALENDAR', '')],
  ])('throws NotIcsError for %s', (_label, text) => {
    expect(() => parseFeed(text, WINDOW)).toThrow(NotIcsError);
  });
});
