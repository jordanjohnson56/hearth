/** What the header shows: the wall-clock time and the date, in one zone. */
export interface ClockFace {
  /** e.g. `7:42 AM` (locale-dependent). */
  time: string;
  /** e.g. `Saturday, August 1` (locale-dependent). */
  date: string;
}

/**
 * Formats `instant` as it reads on a wall clock in `zone`, whatever the
 * device's own zone. `locale` defaults to the runtime's. Throws RangeError
 * for an unknown zone.
 */
export function formatClock(instant: Date, zone: string, locale?: string): ClockFace {
  const time = formatTime(instant, zone, locale);
  const date = new Intl.DateTimeFormat(locale, {
    timeZone: zone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(instant);
  return { time, date };
}

/**
 * The time half of the clock face (`7:42 AM`), for an event's start or end
 * shown beside the header clock: the same options, so the two read alike.
 */
export function formatTime(instant: Date, zone: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(instant);
}
