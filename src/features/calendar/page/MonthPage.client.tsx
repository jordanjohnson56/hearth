import { useEffect, useRef, useState } from 'react';
import { followLink, navigate, useRoute } from '../../../client/router.js';
import { useFeatureData } from '../../../client/useFeatureData.js';
import { useNow } from '../../../client/useNow.js';
import { configuredZone } from '../../../client/zone.js';
import { formatClock } from '../../../core/clock.js';
import {
  addMonths,
  eventsByDate,
  isMonthLoaded,
  loadedMonths,
  localDateOf,
  monthGrid,
  monthPath,
  parseMonthPath,
  splitPills,
  yearMonthOf,
} from '../monthGrid.js';
import type { GridCell, YearMonth } from '../monthGrid.js';
import type { CalendarEventWire, EventsResponse, SourceSummaryWire } from '../types.js';
import '../month.css';

const zone = configuredZone();

// Formatting of grid dates: a `YYYY-MM-DD` read as UTC midnight and printed
// in UTC names the right day whatever the device's zone.
const monthTitleFormat = new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', month: 'long', year: 'numeric' });
const longDateFormat = new Intl.DateTimeFormat(undefined, {
  timeZone: 'UTC',
  weekday: 'long',
  month: 'long',
  day: 'numeric',
});
const shortDateFormat = new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', month: 'short', day: 'numeric' });
// Event instants are formatted in the household's zone, like the clock.
const instantDateFormat = new Intl.DateTimeFormat(undefined, { timeZone: zone, month: 'short', day: 'numeric' });
const weekdayFormat = new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', weekday: 'short' });

// 2023-01-01 was a Sunday.
const WEEKDAYS = Array.from({ length: 7 }, (_, index) => weekdayFormat.format(new Date(Date.UTC(2023, 0, 1 + index))));

function atUtcMidnight(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function titleOf(target: YearMonth): string {
  return monthTitleFormat.format(new Date(Date.UTC(target.year, target.month - 1, 1)));
}

function timeOf(epochMs: number): string {
  return formatClock(new Date(epochMs), zone).time;
}

async function fetchEvents(from: string, to: string, signal: AbortSignal): Promise<EventsResponse> {
  const query = new URLSearchParams({ from, to });
  const res = await fetch(`/api/calendar/events?${query.toString()}`, { signal });
  if (!res.ok) throw new Error(`Could not load events (${String(res.status)})`);
  return (await res.json()) as EventsResponse;
}

/**
 * The Calendar view: one month as a Sunday-first grid, addressed by the
 * URL (`/calendar` is the current month, `/calendar/<year>/<month>` any
 * other), with prev / Today / next, up to three event pills per day and a
 * panel that lists a tapped day in full. One request covers the visible
 * cells, dimmed days of the adjacent months included.
 */
export function MonthPage() {
  const { path } = useRoute();
  const now = useNow();
  const today = localDateOf(now, zone);
  const shown = parseMonthPath(path, yearMonthOf(today));
  const cells = monthGrid(shown.year, shown.month);
  const from = cells[0]?.date ?? today;
  const to = cells[cells.length - 1]?.date ?? today;
  const loaded = isMonthLoaded(shown, now, zone);
  const edges = loadedMonths(now, zone);
  const atFirst = shown.year === edges.first.year && shown.month === edges.first.month;
  const atLast = shown.year === edges.last.year && shown.month === edges.last.month;

  const { data, error } = useFeatureData(
    'calendar',
    (signal) => fetchEvents(from, to, signal),
    `${from}/${to}`,
  );

  // A day stays selected only while its cell is on screen: moving to another
  // month closes the panel without an effect.
  const [selected, setSelected] = useState<string | null>(null);
  const open = selected !== null && cells.some((cell) => cell.date === selected) ? selected : null;

  const byDate = loaded && data ? eventsByDate(data.events, zone) : new Map<string, CalendarEventWire[]>();
  const sources = new Map<number, SourceSummaryWire>((data?.sources ?? []).map((source) => [source.id, source]));
  const title = titleOf(shown);

  const goTo = (target: YearMonth) => {
    navigate(monthPath(target));
  };

  if (data !== undefined && data.sources.length === 0) {
    return (
      <section className="empty-state" aria-label="Calendar">
        <h1 className="empty-state-title">No calendars yet</h1>
        <p>Add a calendar in Admin and its events appear here, color-coded per calendar.</p>
        <a className="link-button" href="/admin" onClick={followLink}>
          Open Admin
        </a>
      </section>
    );
  }

  return (
    <section className="month-page" aria-label="Calendar">
      <header className="month-header">
        <h1 className="month-title">{title}</h1>
        <nav className="month-nav" aria-label="Months">
          <button
            type="button"
            className="month-nav-button"
            disabled={atFirst}
            aria-disabled={atFirst}
            aria-label="Previous month"
            onClick={() => { goTo(addMonths(shown, -1)); }}
          >
            <span aria-hidden="true">‹</span>
          </button>
          <button type="button" className="month-nav-button" onClick={() => { navigate('/calendar'); }}>
            Today
          </button>
          <button
            type="button"
            className="month-nav-button"
            disabled={atLast}
            aria-disabled={atLast}
            aria-label="Next month"
            onClick={() => { goTo(addMonths(shown, 1)); }}
          >
            <span aria-hidden="true">›</span>
          </button>
        </nav>
      </header>
      {!loaded && (
        <p className="month-note" role="status">
          This month is not loaded. Hearth keeps {titleOf(edges.first)} through {titleOf(edges.last)}.
        </p>
      )}
      {loaded && data === undefined && (
        <p className="month-note" role="status" data-tone={error === undefined ? 'info' : 'error'}>
          {error ?? 'Loading…'}
        </p>
      )}
      <div className="month-body" data-panel-open={open !== null ? 'true' : undefined}>
        <div className="month-grid-wrap">
          <div className="month-weekdays" aria-hidden="true">
            {WEEKDAYS.map((name) => (
              <span key={name} className="month-weekday">
                {name}
              </span>
            ))}
          </div>
          <div className="month-grid">
            {cells.map((cell) => (
              <DayCell
                key={cell.date}
                cell={cell}
                events={byDate.get(cell.date) ?? []}
                sources={sources}
                isToday={cell.date === today}
                isOpen={cell.date === open}
                onOpen={() => { setSelected(cell.date === open ? null : cell.date); }}
              />
            ))}
          </div>
        </div>
        {open !== null && (
          <DayPanel
            date={open}
            events={byDate.get(open) ?? []}
            sources={sources}
            onClose={() => { setSelected(null); }}
          />
        )}
      </div>
    </section>
  );
}

function colorOf(sources: ReadonlyMap<number, SourceSummaryWire>, event: CalendarEventWire): string {
  const token = sources.get(event.sourceId)?.color ?? 'slate';
  return `var(--person-${token})`;
}

function DayCell({
  cell,
  events,
  sources,
  isToday,
  isOpen,
  onOpen,
}: {
  cell: GridCell;
  events: readonly CalendarEventWire[];
  sources: ReadonlyMap<number, SourceSummaryWire>;
  isToday: boolean;
  isOpen: boolean;
  onOpen: () => void;
}) {
  const { shown, more } = splitPills(events);
  const count = events.length === 1 ? '1 event' : `${String(events.length)} events`;
  return (
    <button
      type="button"
      className="month-cell"
      data-in-month={cell.inMonth ? 'true' : 'false'}
      aria-current={isToday ? 'date' : undefined}
      aria-pressed={isOpen}
      aria-label={`${longDateFormat.format(atUtcMidnight(cell.date))}, ${count}`}
      onClick={onOpen}
    >
      <span className="month-cell-day">{Number(cell.date.slice(8))}</span>
      <span className="month-cell-pills">
        {shown.map((event) => (
          <span key={event.id} className="month-pill" style={{ borderColor: colorOf(sources, event) }}>
            {event.kind === 'timed' && <span className="month-pill-time">{timeOf(event.startAt)}</span>}
            <span className="month-pill-title">{event.title}</span>
          </span>
        ))}
        {more > 0 && <span className="month-more">+{more}</span>}
      </span>
    </button>
  );
}

/** When an event happens, as the panel reads it from `date`'s point of view. */
function whenOf(event: CalendarEventWire, date: string): string {
  if (event.kind === 'allDay') {
    const lastDate = new Date(atUtcMidnight(event.endDate).getTime() - 1);
    const multiDay = event.endDate > event.startDate && lastDate.toISOString().slice(0, 10) !== event.startDate;
    if (!multiDay) return 'All day';
    return `All day, ${shortDateFormat.format(atUtcMidnight(event.startDate))} to ${shortDateFormat.format(lastDate)}`;
  }
  const start = new Date(event.startAt);
  const end = new Date(event.endAt);
  const sameDay = localDateOf(start, zone) === localDateOf(end, zone);
  if (sameDay) return `${timeOf(event.startAt)} to ${timeOf(event.endAt)}`;
  const startsHere = localDateOf(start, zone) === date;
  const endsHere = localDateOf(end, zone) === date;
  const startText = startsHere ? timeOf(event.startAt) : `${instantDateFormat.format(start)}, ${timeOf(event.startAt)}`;
  const endText = endsHere ? timeOf(event.endAt) : `${instantDateFormat.format(end)}, ${timeOf(event.endAt)}`;
  return `${startText} to ${endText}`;
}

function DayPanel({
  date,
  events,
  sources,
  onClose,
}: {
  date: string;
  events: readonly CalendarEventWire[];
  sources: ReadonlyMap<number, SourceSummaryWire>;
  onClose: () => void;
}) {
  const heading = longDateFormat.format(atUtcMidnight(date));
  const panel = useRef<HTMLElement>(null);
  // On a narrow screen the panel renders below the grid, out of view.
  useEffect(() => {
    panel.current?.scrollIntoView({ block: 'nearest' });
  }, [date]);

  return (
    <aside className="month-day" aria-label={`Events on ${heading}`} ref={panel}>
      <header className="month-day-header">
        <h2 className="month-day-title">{heading}</h2>
        <button type="button" className="month-nav-button" aria-label="Close" onClick={onClose}>
          <span aria-hidden="true">×</span>
        </button>
      </header>
      {events.length === 0 ? (
        <p className="month-day-empty">Nothing on this day.</p>
      ) : (
        <ul className="month-day-list">
          {events.map((event) => (
            <li key={event.id} className="month-day-event" style={{ borderColor: colorOf(sources, event) }}>
              <span className="month-day-when">{whenOf(event, date)}</span>
              <span className="month-day-name">{event.title}</span>
              {event.location !== null && <span className="month-day-where">{event.location}</span>}
              <span className="month-day-source">{sources.get(event.sourceId)?.label ?? 'Calendar'}</span>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
