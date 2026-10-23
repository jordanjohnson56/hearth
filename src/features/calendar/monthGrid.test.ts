import { describe, expect, it } from 'vitest';
import {
  MONTHS_AHEAD,
  MONTHS_BACK,
  addMonths,
  eventsByDate,
  isMonthLoaded,
  loadedMonths,
  monthGrid,
  monthPath,
  parseMonthPath,
  splitPills,
} from './monthGrid.js';
import { MONTHS_AHEAD as POLL_MONTHS_AHEAD, MONTHS_BACK as POLL_MONTHS_BACK } from './window.js';
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

function allDay(id: number, startDate: string, endDate: string): CalendarEventWire {
  return { id, sourceId: 1, uid: `u${String(id)}`, recurrenceId: null, title: `Event ${String(id)}`, location: null, kind: 'allDay', startDate, endDate };
}

function timed(id: number, startAt: string, endAt: string): CalendarEventWire {
  return {
    id,
    sourceId: 1,
    uid: `u${String(id)}`,
    recurrenceId: null,
    title: `Event ${String(id)}`,
    location: null,
    kind: 'timed',
    startAt: Date.parse(startAt),
    endAt: Date.parse(endAt),
  };
}

const ids = (events: readonly CalendarEventWire[] | undefined) => (events ?? []).map((event) => event.id);

describe('eventsByDate', () => {
  it('puts an all-day event on every date from its start up to its exclusive end', () => {
    const byDate = eventsByDate([allDay(1, '2026-07-29', '2026-08-05')], CHICAGO);
    expect(ids(byDate.get('2026-07-28'))).toEqual([]);
    expect(ids(byDate.get('2026-07-29'))).toEqual([1]);
    expect(ids(byDate.get('2026-08-01'))).toEqual([1]);
    expect(ids(byDate.get('2026-08-04'))).toEqual([1]);
    expect(ids(byDate.get('2026-08-05'))).toEqual([]);
  });

  it('puts a timed event on each local date it touches in the zone', () => {
    // 21:00 to 01:00 Chicago (CDT) is 02:00Z to 06:00Z the next day.
    const byDate = eventsByDate([timed(2, '2026-08-15T02:00:00Z', '2026-08-15T06:00:00Z')], CHICAGO);
    expect(ids(byDate.get('2026-08-14'))).toEqual([2]);
    expect(ids(byDate.get('2026-08-15'))).toEqual([2]);
    expect(ids(byDate.get('2026-08-16'))).toEqual([]);
  });

  it('does not spill a timed event that ends exactly at midnight onto the next day', () => {
    // 22:00 to 00:00 Chicago.
    const byDate = eventsByDate([timed(3, '2026-08-21T03:00:00Z', '2026-08-21T05:00:00Z')], CHICAGO);
    expect(ids(byDate.get('2026-08-20'))).toEqual([3]);
    expect(ids(byDate.get('2026-08-21'))).toEqual([]);
  });

  it('orders a day as all-day events first, then timed by start', () => {
    const byDate = eventsByDate(
      [
        timed(10, '2026-08-03T20:00:00Z', '2026-08-03T21:00:00Z'),
        timed(11, '2026-08-03T14:00:00Z', '2026-08-03T15:00:00Z'),
        allDay(12, '2026-08-03', '2026-08-04'),
        timed(13, '2026-08-03T03:00:00Z', '2026-08-03T04:00:00Z'),
      ],
      CHICAGO,
    );
    // Event 13 is the evening of the 2nd in Chicago.
    expect(ids(byDate.get('2026-08-03'))).toEqual([12, 11, 10]);
    expect(ids(byDate.get('2026-08-02'))).toEqual([13]);
  });
});

describe('splitPills', () => {
  const five = [1, 2, 3, 4, 5].map((id) => allDay(id, '2026-08-03', '2026-08-04'));

  it('shows at most three pills and counts the rest', () => {
    const { shown, more } = splitPills(five);
    expect(ids(shown)).toEqual([1, 2, 3]);
    expect(more).toBe(2);
  });

  it('shows three events without a count', () => {
    expect(splitPills(five.slice(0, 3))).toEqual({ shown: five.slice(0, 3), more: 0 });
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

  it('matches the server poll window constants', () => {
    expect(MONTHS_BACK).toBe(POLL_MONTHS_BACK);
    expect(MONTHS_AHEAD).toBe(POLL_MONTHS_AHEAD);
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
