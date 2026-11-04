import { describe, expect, it } from 'vitest';
import {
  addMonths,
  eventsByDate,
  isMonthLoaded,
  loadedMonths,
  monthGrid,
  monthPath,
  parseMonthPath,
  weekLayout,
} from './monthGrid.js';
import { allDay, timed } from '../../../test/helpers/wireEvents.js';
import type { CalendarEventWire } from './types.js';

describe('monthGrid', () => {
  it('starts on the Sunday on or before the first and pads a four-week month to five rows', () => {
    // February 2026 starts on a Sunday and has 28 days: four rows would fit,
    // but the grid keeps five so the page does not jump month to month.
    const cells = monthGrid(2026, 2);
    expect(cells).toHaveLength(35);
    expect(cells[0]).toEqual({ date: '2026-02-01', inMonth: true });
    expect(cells[27]).toEqual({ date: '2026-02-28', inMonth: true });
    expect(cells[28]).toEqual({ date: '2026-03-01', inMonth: false });
    expect(cells[34]).toEqual({ date: '2026-03-07', inMonth: false });
  });

  it('takes six rows when the month needs them', () => {
    // August 2026 starts on a Saturday: 5 leading days + 31 = 36 cells.
    const cells = monthGrid(2026, 8);
    expect(cells).toHaveLength(42);
    expect(cells[0]).toEqual({ date: '2026-07-26', inMonth: false });
    expect(cells[6]).toEqual({ date: '2026-08-01', inMonth: true });
    expect(cells[36]).toEqual({ date: '2026-08-31', inMonth: true });
    expect(cells[41]).toEqual({ date: '2026-09-05', inMonth: false });
  });

  it('fills exactly five rows for a month that ends on a Saturday', () => {
    // October 2026: Thursday the 1st, Saturday the 31st.
    const cells = monthGrid(2026, 10);
    expect(cells).toHaveLength(35);
    expect(cells[0]).toEqual({ date: '2026-09-27', inMonth: false });
    expect(cells[4]).toEqual({ date: '2026-10-01', inMonth: true });
    expect(cells[34]).toEqual({ date: '2026-10-31', inMonth: true });
  });

  it('counts the leap day', () => {
    const cells = monthGrid(2028, 2);
    expect(cells.filter((cell) => cell.inMonth)).toHaveLength(29);
    expect(cells[0]).toEqual({ date: '2028-01-30', inMonth: false });
  });
});

const CHICAGO = 'America/Chicago';

const ids = (events: readonly CalendarEventWire[] | undefined) => (events ?? []).map((event) => event.id);

describe('eventsByDate', () => {
  it('puts an all-day event on every date from its start up to its exclusive end', () => {
    const byDate = eventsByDate([allDay('2026-07-29', '2026-08-05', { id: 1 })], CHICAGO);
    expect(ids(byDate.get('2026-07-28'))).toEqual([]);
    expect(ids(byDate.get('2026-07-29'))).toEqual([1]);
    expect(ids(byDate.get('2026-08-01'))).toEqual([1]);
    expect(ids(byDate.get('2026-08-04'))).toEqual([1]);
    expect(ids(byDate.get('2026-08-05'))).toEqual([]);
  });

  it('puts a timed event on each local date it touches in the zone', () => {
    // 21:00 to 01:00 Chicago (CDT) is 02:00Z to 06:00Z the next day.
    const byDate = eventsByDate([timed('2026-08-15T02:00:00Z', '2026-08-15T06:00:00Z', { id: 2 })], CHICAGO);
    expect(ids(byDate.get('2026-08-14'))).toEqual([2]);
    expect(ids(byDate.get('2026-08-15'))).toEqual([2]);
    expect(ids(byDate.get('2026-08-16'))).toEqual([]);
  });

  it('does not spill a timed event that ends exactly at midnight onto the next day', () => {
    // 22:00 to 00:00 Chicago.
    const byDate = eventsByDate([timed('2026-08-21T03:00:00Z', '2026-08-21T05:00:00Z', { id: 3 })], CHICAGO);
    expect(ids(byDate.get('2026-08-20'))).toEqual([3]);
    expect(ids(byDate.get('2026-08-21'))).toEqual([]);
  });

  it('orders a day as all-day events first, then timed by start', () => {
    const byDate = eventsByDate(
      [
        timed('2026-08-03T20:00:00Z', '2026-08-03T21:00:00Z', { id: 10 }),
        timed('2026-08-03T14:00:00Z', '2026-08-03T15:00:00Z', { id: 11 }),
        allDay('2026-08-03', '2026-08-04', { id: 12 }),
        timed('2026-08-03T03:00:00Z', '2026-08-03T04:00:00Z', { id: 13 }),
      ],
      CHICAGO,
    );
    // Event 13 is the evening of the 2nd in Chicago.
    expect(ids(byDate.get('2026-08-03'))).toEqual([12, 11, 10]);
    expect(ids(byDate.get('2026-08-02'))).toEqual([13]);
  });
});

describe('weekLayout', () => {
  // August 2026 starts on a Saturday: the second week is Aug 2-8.
  const cells = monthGrid(2026, 8);
  const week = (layout: ReturnType<typeof weekLayout>, sunday: string) => {
    const found = layout.find((w) => w.cells[0]?.date === sunday);
    if (found === undefined) throw new Error(`no week starting ${sunday}`);
    return found;
  };
  const spanOf = (span: { event: CalendarEventWire; startColumn: number; endColumn: number; lane: number; continuesBefore: boolean; continuesAfter: boolean }) => ({
    id: span.event.id,
    columns: [span.startColumn, span.endColumn],
    lane: span.lane,
    before: span.continuesBefore,
    after: span.continuesAfter,
  });

  it('splits the grid into Sunday-first weeks', () => {
    const layout = weekLayout(cells, [], CHICAGO);
    expect(layout).toHaveLength(6);
    expect(layout.map((w) => w.cells[0]?.date)).toEqual(['2026-07-26', '2026-08-02', '2026-08-09', '2026-08-16', '2026-08-23', '2026-08-30']);
    expect(layout.every((w) => w.cells.length === 7 && w.lanes === 0 && w.spans.length === 0)).toBe(true);
  });

  it('keeps single-day events in their square, three lines and a count', () => {
    const five = [1, 2, 3, 4, 5].map((id) => allDay('2026-08-04', '2026-08-05', { id }));
    const day = week(weekLayout(cells, five, CHICAGO), '2026-08-02').days.get('2026-08-04');
    expect(ids(day?.shown)).toEqual([1, 2, 3]);
    expect(day?.more).toBe(2);
  });

  it('draws a multi-day event once across its days, out of the squares', () => {
    const layout = weekLayout(cells, [allDay('2026-08-04', '2026-08-07', { id: 1 })], CHICAGO);
    const w = week(layout, '2026-08-02');
    expect(w.spans.map(spanOf)).toEqual([{ id: 1, columns: [2, 4], lane: 0, before: false, after: false }]);
    expect(w.lanes).toBe(1);
    expect(ids(w.days.get('2026-08-05')?.shown)).toEqual([]);
  });

  it('breaks an event that crosses a week edge into one span per week', () => {
    // Thursday Aug 6 through Monday Aug 10.
    const layout = weekLayout(cells, [allDay('2026-08-06', '2026-08-11', { id: 1 })], CHICAGO);
    expect(week(layout, '2026-08-02').spans.map(spanOf)).toEqual([{ id: 1, columns: [4, 6], lane: 0, before: false, after: true }]);
    expect(week(layout, '2026-08-09').spans.map(spanOf)).toEqual([{ id: 1, columns: [0, 1], lane: 0, before: true, after: false }]);
  });

  it('reuses a free row, and past two rows counts the event in each of its days', () => {
    const events = [
      allDay('2026-08-02', '2026-08-05', { id: 1 }), // Sun-Tue
      allDay('2026-08-03', '2026-08-07', { id: 2 }), // Mon-Thu, overlaps 1
      allDay('2026-08-06', '2026-08-09', { id: 3 }), // Thu-Sat, overlaps 2 only
      allDay('2026-08-04', '2026-08-06', { id: 4 }), // Tue-Wed, overlaps 1 and 2
      allDay('2026-08-04', '2026-08-05', { id: 5 }), // single day, Tue
      allDay('2026-08-04', '2026-08-05', { id: 6 }), // single day, Tue
    ];
    const w = week(weekLayout(cells, events, CHICAGO), '2026-08-02');
    expect(w.spans.map((s) => [s.event.id, s.lane])).toEqual([[1, 0], [2, 1], [3, 0]]);
    expect(w.lanes).toBe(2);
    // Two rows leave one line per square: 5 shows; 6 and the hidden span 4 are counted.
    expect(ids(w.days.get('2026-08-04')?.shown)).toEqual([5]);
    expect(w.days.get('2026-08-04')?.more).toBe(2);
    expect(w.days.get('2026-08-05')?.more).toBe(1);
    expect(w.days.get('2026-08-06')?.more).toBe(0);
  });

  it('treats a timed event past local midnight as multi-day, in the zone', () => {
    // 21:00 to 01:00 Chicago (CDT) crosses midnight; in UTC it would not.
    const overnight = timed('2026-08-05T02:00:00Z', '2026-08-05T06:00:00Z', { id: 1 });
    const w = week(weekLayout(cells, [overnight], CHICAGO), '2026-08-02');
    expect(w.spans.map(spanOf)).toEqual([{ id: 1, columns: [2, 3], lane: 0, before: false, after: false }]);
  });
});

describe('loadedMonths', () => {
  const now = new Date('2026-10-23T12:00:00Z');

  it('spans the month three back through the month twelve ahead, like the poll window', () => {
    expect(loadedMonths(now, CHICAGO)).toEqual({
      first: { year: 2026, month: 7 },
      last: { year: 2027, month: 10 },
    });
  });

  it('is computed from the local date in the zone', () => {
    // 2026-11-01 03:00Z is still the evening of Oct 31 in Chicago.
    const late = new Date('2026-11-01T03:00:00Z');
    expect(loadedMonths(late, CHICAGO).first).toEqual({ year: 2026, month: 7 });
    expect(loadedMonths(late, 'UTC').first).toEqual({ year: 2026, month: 8 });
  });
});

describe('isMonthLoaded', () => {
  const now = new Date('2026-10-23T12:00:00Z');

  it('is true inside the window edges inclusive and false just outside', () => {
    expect(isMonthLoaded({ year: 2026, month: 7 }, now, CHICAGO)).toBe(true);
    expect(isMonthLoaded({ year: 2026, month: 6 }, now, CHICAGO)).toBe(false);
    expect(isMonthLoaded({ year: 2027, month: 10 }, now, CHICAGO)).toBe(true);
    expect(isMonthLoaded({ year: 2027, month: 11 }, now, CHICAGO)).toBe(false);
    expect(isMonthLoaded({ year: 2025, month: 12 }, now, CHICAGO)).toBe(false);
  });
});

describe('addMonths', () => {
  it('wraps across years in both directions', () => {
    expect(addMonths({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(addMonths({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
    expect(addMonths({ year: 2026, month: 10 }, -3)).toEqual({ year: 2026, month: 7 });
    expect(addMonths({ year: 2026, month: 10 }, 12)).toEqual({ year: 2027, month: 10 });
  });
});

describe('parseMonthPath', () => {
  const current = { year: 2026, month: 10 };

  it('reads /calendar/<year>/<month>', () => {
    expect(parseMonthPath('/calendar/2026/8', current)).toEqual({ year: 2026, month: 8 });
    expect(parseMonthPath('/calendar/2027/01/', current)).toEqual({ year: 2027, month: 1 });
  });

  it('falls back to the current month for /calendar and for anything invalid', () => {
    expect(parseMonthPath('/calendar', current)).toEqual(current);
    expect(parseMonthPath('/calendar/', current)).toEqual(current);
    expect(parseMonthPath('/calendar/2026', current)).toEqual(current);
    expect(parseMonthPath('/calendar/2026/13', current)).toEqual(current);
    expect(parseMonthPath('/calendar/2026/0', current)).toEqual(current);
    expect(parseMonthPath('/calendar/abc/8', current)).toEqual(current);
    expect(parseMonthPath('/calendar/2026/8/extra', current)).toEqual(current);
    expect(parseMonthPath('/calendar/99999/8', current)).toEqual(current);
  });

  it('round-trips through monthPath', () => {
    expect(monthPath({ year: 2026, month: 8 })).toBe('/calendar/2026/8');
    expect(parseMonthPath(monthPath({ year: 2027, month: 12 }), current)).toEqual({ year: 2027, month: 12 });
  });
});
