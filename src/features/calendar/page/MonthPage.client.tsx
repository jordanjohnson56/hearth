import { useEffect, useRef, useState } from 'react';
import { followLink, navigate, useRoute } from '../../../client/router.js';
import { useFeatureData } from '../../../client/useFeatureData.js';
import { useNow } from '../../../client/useNow.js';
import { configuredZone } from '../../../client/zone.js';
import { formatTime } from '../../../core/clock.js';
import { addDays, localDateOf } from '../../../core/localDateText.js';
import { fetchEvents } from '../api.client.js';
import {
  addMonths,
  eventsByDate,
  isMonthLoaded,
  loadedMonths,
  monthGrid,
  monthPath,
  parseMonthPath,
  weekLayout,
  yearMonthOf,
} from '../monthGrid.js';
import type { GridCell, WeekSpan, YearMonth } from '../monthGrid.js';
import { withSources } from '../wireEvents.js';
import type { SourcedEvent } from '../wireEvents.js';
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
const weekdayLongFormat = new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', weekday: 'long' });

// 2023-01-01 was a Sunday.
const WEEKDAYS = Array.from({ length: 7 }, (_, index) => {
  const day = new Date(Date.UTC(2023, 0, 1 + index));
  return { short: weekdayFormat.format(day), long: weekdayLongFormat.format(day) };
});

function atUtcMidnight(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function titleOf(target: YearMonth): string {
  return monthTitleFormat.format(new Date(Date.UTC(target.year, target.month - 1, 1)));
}

/** The title in the locale's order, the month name marked so it can be written large. */
function MonthTitle({ target }: { target: YearMonth }) {
  const parts = monthTitleFormat.formatToParts(new Date(Date.UTC(target.year, target.month - 1, 1)));
  return (
    <h1 className="month-title">
      {parts.map((part, index) =>
        part.type === 'month' ? (
          <span key={index} className="month-title-name">
            {part.value}
          </span>
        ) : (
          <span key={index} className="month-title-rest">
            {part.value}
          </span>
        ),
      )}
    </h1>
  );
}

function timeOf(epochMs: number): string {
  return formatTime(new Date(epochMs), zone);
}

const shortTimeFormat = new Intl.DateTimeFormat(undefined, { timeZone: zone, hour: 'numeric', minute: '2-digit' });

/**
 * A start time as short as a square allows: `6:30a`, `5p`, or `17:00` in a
 * 24-hour locale, so the title keeps most of the line.
 */
function shortTimeOf(epochMs: number): string {
  const parts = shortTimeFormat.formatToParts(new Date(epochMs));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  const period = part('dayPeriod');
  if (period === '') return `${part('hour')}:${part('minute')}`;
  const minute = part('minute');
  return `${part('hour')}${minute === '00' ? '' : `:${minute}`}${period.charAt(0).toLowerCase()}`;
}

/**
 * The Calendar view: one month as a Sunday-first grid, addressed by the
 * URL (`/calendar` is the current month, `/calendar/<year>/<month>` any
 * other), with prev / Today / next. It is drawn like a family whiteboard
 * (weekLayout): each event written in its person's color, a multi-day
 * event as one line across its days, and a panel that lists a tapped day
 * in full. One request covers the visible
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

  const events = loaded && data ? withSources(data) : [];
  const byDate = eventsByDate(events, zone);
  const weeks = weekLayout(cells, events, zone);

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
        <MonthTitle target={shown} />
        <nav className="month-nav" aria-label="Months">
          <button
            type="button"
            className="button month-nav-button"
            disabled={atFirst}
            aria-disabled={atFirst}
            aria-label="Previous month"
            onClick={() => { goTo(addMonths(shown, -1)); }}
          >
            <span aria-hidden="true">‹</span>
          </button>
          <button type="button" className="button month-nav-button" onClick={() => { navigate('/calendar'); }}>
            Today
          </button>
          <button
            type="button"
            className="button month-nav-button"
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
        <div className="month-board">
          <div className="month-weekdays" aria-hidden="true">
            {WEEKDAYS.map((name) => (
              <span key={name.long} className="month-weekday">
                <span className="month-weekday-short">{name.short}</span>
                <span className="month-weekday-long">{name.long}</span>
              </span>
            ))}
          </div>
          <div className="month-grid">
            {weeks.map((week) => (
              <div key={week.cells[0]?.date} className="month-week" data-lanes={week.lanes}>
                {week.cells.map((cell, column) => (
                  <DayCell
                    key={cell.date}
                    cell={cell}
                    column={column}
                    shown={week.days.get(cell.date)?.shown ?? []}
                    more={week.days.get(cell.date)?.more ?? 0}
                    total={byDate.get(cell.date)?.length ?? 0}
                    isToday={cell.date === today}
                    isOpen={cell.date === open}
                    onOpen={() => { setSelected(cell.date === open ? null : cell.date); }}
                  />
                ))}
                {week.spans.map((span) => (
                  <SpanLine key={span.event.id} span={span} />
                ))}
              </div>
            ))}
          </div>
        </div>
        {open !== null && (
          <DayPanel
            date={open}
            events={byDate.get(open) ?? []}
            onClose={() => { setSelected(null); }}
          />
        )}
      </div>
    </section>
  );
}

function colorOf(event: SourcedEvent): string {
  return `var(--person-${event.source.color})`;
}

function DayCell({
  cell,
  column,
  shown,
  more,
  total,
  isToday,
  isOpen,
  onOpen,
}: {
  cell: GridCell;
  column: number;
  shown: readonly SourcedEvent[];
  more: number;
  total: number;
  isToday: boolean;
  isOpen: boolean;
  onOpen: () => void;
}) {
  const count = total === 1 ? '1 event' : `${String(total)} events`;
  return (
    <button
      type="button"
      className="month-cell"
      style={{ gridColumn: column + 1 }}
      data-in-month={cell.inMonth ? 'true' : 'false'}
      aria-current={isToday ? 'date' : undefined}
      aria-pressed={isOpen}
      aria-label={`${longDateFormat.format(atUtcMidnight(cell.date))}, ${count}`}
      onClick={onOpen}
    >
      <span className="month-cell-board">
        <span className="month-cell-day">{Number(cell.date.slice(8))}</span>
        {shown.map((event) => (
          <span key={event.id} className="month-entry" style={{ color: colorOf(event) }}>
            {event.kind === 'timed' && <span className="month-entry-time">{shortTimeOf(event.startAt)}</span>}
            {event.title}
          </span>
        ))}
        {more > 0 && <span className="month-more">+{more}</span>}
      </span>
    </button>
  );
}

/**
 * A multi-day event as the whiteboard writes it: the title once, then a
 * line in the same marker across the rest of its days in this week, ending
 * in a tick, or running off the edge when it carries on into the next week.
 * Taps fall through to the day squares underneath; the day panel and each
 * square's label carry the event for assistive tech.
 */
function SpanLine({ span }: { span: WeekSpan<SourcedEvent> }) {
  return (
    <span
      className="month-span"
      aria-hidden="true"
      data-before={span.continuesBefore ? 'true' : undefined}
      data-after={span.continuesAfter ? 'true' : undefined}
      style={{
        color: colorOf(span.event),
        gridColumn: `${String(span.startColumn + 1)} / ${String(span.endColumn + 2)}`,
        gridRow: span.lane + 2,
      }}
    >
      {span.continuesBefore && <span className="month-span-line month-span-lead" />}
      <span className="month-span-title">{span.event.title}</span>
      <span className="month-span-line" />
    </span>
  );
}

/** When an event happens, as the panel reads it from `date`'s point of view. */
function whenOf(event: SourcedEvent, date: string): string {
  if (event.kind === 'allDay') {
    // The end is exclusive: the last day shown is the one before it.
    const lastDate = addDays(event.endDate, -1);
    if (lastDate <= event.startDate) return 'All day';
    return `All day, ${shortDateFormat.format(atUtcMidnight(event.startDate))} to ${shortDateFormat.format(atUtcMidnight(lastDate))}`;
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
  onClose,
}: {
  date: string;
  events: readonly SourcedEvent[];
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
        <button type="button" className="button month-nav-button" aria-label="Close" onClick={onClose}>
          <span aria-hidden="true">×</span>
        </button>
      </header>
      {events.length === 0 ? (
        <p className="month-day-empty">Nothing on this day.</p>
      ) : (
        <ul className="month-day-list">
          {events.map((event) => (
            <li key={event.id} className="month-day-event" style={{ borderColor: colorOf(event) }}>
              <span className="month-day-when">{whenOf(event, date)}</span>
              <span className="month-day-name">{event.title}</span>
              {event.location !== null && <span className="month-day-where">{event.location}</span>}
              <span className="month-day-source">{event.source.label}</span>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
