import { useEffect, useRef } from 'react';
import { followLink } from '../../../client/router.js';
import { useFeatureData } from '../../../client/useFeatureData.js';
import { useNow } from '../../../client/useNow.js';
import { configuredZone } from '../../../client/zone.js';
import { formatTime } from '../../../core/clock.js';
import { addDays, localDateOf } from '../../../core/localDateText.js';
import { fetchEvents } from '../api.client.js';
import { stalenessLine, todaysEvents } from '../dayAtAGlance.js';
import type { GlanceEvent, GlanceTiming } from '../dayAtAGlance.js';
import '../dayAtAGlance.css';

const zone = configuredZone();

/** Like the header clock, so "3:00 PM" reads the same in the tile and above it. */
function timeOf(instant: Date): string {
  return formatTime(instant, zone);
}

/**
 * The Home tile: all of today in the configured zone, all-day events first,
 * then timed by start, what is over dimmed, scrolling inside the tile.
 * Tomorrow is fetched too, so an event that crosses midnight is already in
 * hand when the day turns; todaysEvents decides what shows.
 */
export function DayAtAGlance() {
  const now = useNow();
  const today = localDateOf(now, zone);
  const { data, error, refetch } = useFeatureData('calendar', (signal) =>
    fetchEvents(today, addDays(today, 1), signal),
  );

  // Fetched on mount by the hook; fetch again when the date turns over so a
  // new day does not wait for the backstop.
  const fetchedFor = useRef(today);
  useEffect(() => {
    if (fetchedFor.current === today) return;
    fetchedFor.current = today;
    refetch();
  }, [today, refetch]);

  const stale = data === undefined ? undefined : stalenessLine(data.newestSuccessAt, now);

  return (
    <section className="glance" aria-labelledby="glance-heading">
      <h2 id="glance-heading" className="glance-heading">
        Today
      </h2>
      {data === undefined ? (
        <p className="glance-note">{error === undefined ? 'Loading…' : 'The calendar could not be loaded.'}</p>
      ) : data.sources.length === 0 ? (
        <div className="glance-empty">
          <p className="glance-note">No calendars are set up yet.</p>
          <a className="link-button" href="/admin" onClick={followLink}>
            Add one in Admin
          </a>
        </div>
      ) : (
        <EventList events={todaysEvents(data, now, zone)} />
      )}
      {stale !== undefined && <p className="glance-stale">{stale}</p>}
    </section>
  );
}

function EventList({ events }: { events: GlanceEvent[] }) {
  if (events.length === 0) return <p className="glance-note">Nothing on the calendar today.</p>;
  return (
    <ul className="glance-list">
      {events.map((event) => (
        <li
          key={event.id}
          className="glance-event"
          data-over={event.over ? '' : undefined}
          style={{ borderColor: `var(--person-${event.color})` }}
        >
          <span className="visually-hidden">{event.sourceLabel}: </span>
          <EventTime timing={event.timing} />
          <span className="glance-event-title">{event.title}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The time prefix. A timed event within today shows its start; one that
 * runs past midnight "from <start>"; one that began on an earlier day
 * "until <end>"; one that began earlier and ends later "all day". An
 * all-day event has no prefix.
 */
function EventTime({ timing }: { timing: GlanceTiming }) {
  if (timing.kind === 'allDay') return null;
  const start = new Date(timing.startAt);
  const end = new Date(timing.endAt);
  switch (timing.span) {
    case 'within':
      return (
        <time className="glance-event-time" dateTime={start.toISOString()}>
          {timeOf(start)}
        </time>
      );
    case 'startsToday':
      return (
        <time className="glance-event-time" dateTime={start.toISOString()}>
          from {timeOf(start)}
        </time>
      );
    case 'endsToday':
      return (
        <time className="glance-event-time" dateTime={end.toISOString()}>
          until {timeOf(end)}
        </time>
      );
    case 'coversToday':
      return <span className="glance-event-time">all day</span>;
  }
}
