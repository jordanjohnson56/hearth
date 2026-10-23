// The theme switch: light by day, dark by night, at two household-chosen
// wall-clock times evaluated in the configured zone. Shared by the server
// (validating the settings) and the browser (applying them every minute),
// so this file stays on Intl: the Temporal polyfill must not reach the
// client bundle (test/clientBundle.test.ts).
import { intlParts } from './intlParts.js';

export type Theme = 'light' | 'dark';

/** The two switch times as stored and sent on the wire: `HH:MM`, 24-hour. */
export interface ThemeTimes {
  lightFrom: string;
  darkFrom: string;
}

/** A wall-clock time of day, hours and minutes only. */
export interface TimeOfDay {
  hour: number;
  minute: number;
}

/** Theme is light at or after this wall time... */
export const DEFAULT_LIGHT_FROM = '07:00';
/** ...and dark at or after this one. */
export const DEFAULT_DARK_FROM = '19:30';

export const DEFAULT_THEME_TIMES: ThemeTimes = {
  lightFrom: DEFAULT_LIGHT_FROM,
  darkFrom: DEFAULT_DARK_FROM,
};

function minuteOfDay(time: TimeOfDay): number {
  return time.hour * 60 + time.minute;
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** True for a 24-hour `HH:MM` with both parts two digits (`07:00`, not `7:00`). */
export function isHHMM(value: unknown): value is string {
  return typeof value === 'string' && HHMM.test(value);
}

/** The hour and minute of an `HH:MM` text; throws RangeError for anything else. */
export function parseHHMM(value: string): TimeOfDay {
  const match = HHMM.exec(value);
  if (match === null) throw new RangeError('expected a time as HH:MM');
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

/**
 * True for a `{ lightFrom, darkFrom }` the server would accept: both
 * `HH:MM` and different. The client checks a fetched body with this before
 * trusting it, since a bad pair would throw on every minute tick.
 */
export function isThemeTimes(value: unknown): value is ThemeTimes {
  if (typeof value !== 'object' || value === null) return false;
  const { lightFrom, darkFrom } = value as Record<string, unknown>;
  return isHHMM(lightFrom) && isHHMM(darkFrom) && lightFrom !== darkFrom;
}

/**
 * The wall-clock hour and minute of `instant` in `zone`. Throws RangeError
 * for an unknown zone, like the clock does.
 */
export function wallTime(instant: Date, zone: string): TimeOfDay {
  const part = intlParts(instant, zone, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return { hour: Number(part('hour')), minute: Number(part('minute')) };
}

/**
 * Which theme the wall shows at `instant` in `zone`: light from `lightFrom`
 * up to (not including) `darkFrom`, dark from `darkFrom` up to (not
 * including) `lightFrom`, in wall-clock minute order. Either period may
 * wrap midnight, so a dark morning with a light evening works too.
 */
export function evaluateTheme(instant: Date, zone: string, times: ThemeTimes): Theme {
  const now = minuteOfDay(wallTime(instant, zone));
  const light = minuteOfDay(parseHHMM(times.lightFrom));
  const dark = minuteOfDay(parseHHMM(times.darkFrom));
  if (light < dark) return now >= light && now < dark ? 'light' : 'dark';
  return now >= dark && now < light ? 'dark' : 'light';
}
