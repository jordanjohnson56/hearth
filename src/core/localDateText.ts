// Local-date helpers the browser can use: Intl parts and plain arithmetic on
// `YYYY-MM-DD` text, with no Temporal polyfill (test/clientBundle.test.ts).
// src/core/time.ts has the same operations on the server, with the polyfill;
// the two must agree, and time.test.ts has the fuller edge cases.

/**
 * The `YYYY-MM-DD` shown on a wall calendar in `zone` at `instant`. Throws
 * RangeError for an unknown zone, like the clock does.
 */
export function localDateOf(instant: Date, zone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const part = (type: 'year' | 'month' | 'day') =>
    parts.find((candidate) => candidate.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/**
 * `date` (`YYYY-MM-DD`) moved by `days`, negative allowed. Done on the UTC
 * calendar, which has no gaps or overlaps, so the result is the plain
 * calendar answer whatever the zone.
 */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const moved = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + days));
  return moved.toISOString().slice(0, 10);
}
