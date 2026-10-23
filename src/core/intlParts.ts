// The one Intl.DateTimeFormat parts lookup the polyfill-free core modules
// share (localDateText.ts, theme.ts): the client's date math runs on it,
// since the Temporal polyfill must not reach the browser bundle (ADR 0001,
// test/clientBundle.test.ts).

/**
 * `instant` formatted in `zone` with `options`, as a lookup by part type:
 * `part('hour')` is the hour's text, '' for a part the options left out.
 * Throws RangeError for an unknown zone, like the clock does.
 */
export function intlParts(
  instant: Date,
  zone: string,
  options: Intl.DateTimeFormatOptions,
): (type: Intl.DateTimeFormatPartTypes) => string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, ...options }).formatToParts(instant);
  return (type) => parts.find((candidate) => candidate.type === type)?.value ?? '';
}
