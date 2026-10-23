import { Temporal } from 'temporal-polyfill';

/** A calendar date as seen on the wall in some zone, as `YYYY-MM-DD`. */
export type LocalDate = string & { readonly __brand: 'LocalDate' };

/** Thrown when an instant is an invalid `Date` (its time value is NaN). */
export class InvalidInstantError extends RangeError {
  constructor() {
    super('Invalid instant: the Date has no time value');
    this.name = 'InvalidInstantError';
  }
}

/** Thrown when a zone is not a named IANA time zone such as `America/Chicago`. */
export class InvalidTimeZoneError extends RangeError {
  readonly zone: string;

  constructor(zone: string) {
    super(`Invalid time zone: ${JSON.stringify(zone)} is not an IANA zone name`);
    this.name = 'InvalidTimeZoneError';
    this.zone = zone;
  }
}

function toZoned(instant: Date, zone: string): Temporal.ZonedDateTime {
  const ms = instant.getTime();
  if (Number.isNaN(ms)) throw new InvalidInstantError();

  let zoned: Temporal.ZonedDateTime;
  try {
    zoned = Temporal.Instant.fromEpochMilliseconds(ms).toZonedDateTimeISO(zone);
  } catch {
    throw new InvalidTimeZoneError(zone);
  }
  // Temporal also accepts fixed offsets ("-06:00") and whole ISO strings
  // ("...[America/Chicago]") as zones. Only a bare zone name carries DST
  // rules, so require the input to be the identifier itself.
  const id = zoned.timeZoneId;
  if (id.toLowerCase() !== zone.toLowerCase() || id.startsWith('+') || id.startsWith('-')) {
    throw new InvalidTimeZoneError(zone);
  }
  return zoned;
}

/**
 * Whether `zone` is a zone the date core accepts: a bare IANA name such as
 * `America/Chicago` (any case, links included), never a fixed offset or an
 * ISO string. The config loader checks TZ with this, so boot accepts exactly
 * what localDate and weekStart accept.
 */
export function isValidZone(zone: string): boolean {
  try {
    toZoned(new Date(0), zone);
    return true;
  } catch (error) {
    if (error instanceof InvalidTimeZoneError) return false;
    throw error;
  }
}

/** The calendar date of `instant` on the wall in `zone`. */
export function localDate(instant: Date, zone: string): LocalDate {
  return toZoned(instant, zone).toPlainDate().toString() as LocalDate;
}

/** The instant at which the week containing `instant` starts in `zone`. */
export function weekStart(instant: Date, zone: string): Date {
  const date = toZoned(instant, zone).toPlainDate();
  // Week starts Monday (ISO dayOfWeek 1).
  const monday = date.subtract({ days: date.dayOfWeek - 1 });
  // Not "00:00 at offset X": midnight may not exist on a DST day, and
  // toZonedDateTime picks the first valid instant of that local day.
  return new Date(monday.toZonedDateTime({ timeZone: zone }).epochMilliseconds);
}

const LOCAL_DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `text` as a LocalDate when it is exactly `YYYY-MM-DD` and a real date,
 * else undefined. Temporal alone also accepts `20260203` and date-times,
 * which are not the wire shape.
 */
export function parseLocalDate(text: string): LocalDate | undefined {
  if (!LOCAL_DATE_SHAPE.test(text)) return undefined;
  try {
    return Temporal.PlainDate.from(text).toString() as LocalDate;
  } catch {
    return undefined;
  }
}

function toPlain(date: LocalDate): Temporal.PlainDate {
  return Temporal.PlainDate.from(date);
}

/** `date` plus `months` (may be negative); the day clamps to the shorter month. */
export function addMonths(date: LocalDate, months: number): LocalDate {
  return toPlain(date).add({ months }).toString() as LocalDate;
}

/** `date` plus `days` (may be negative). */
export function addDays(date: LocalDate, days: number): LocalDate {
  return toPlain(date).add({ days }).toString() as LocalDate;
}

export function startOfMonth(date: LocalDate): LocalDate {
  return toPlain(date).with({ day: 1 }).toString() as LocalDate;
}

export function endOfMonth(date: LocalDate): LocalDate {
  const plain = toPlain(date);
  return plain.with({ day: plain.daysInMonth }).toString() as LocalDate;
}

/** Days from `from` to `to`: positive when `to` is later, zero when equal. */
export function daysBetween(from: LocalDate, to: LocalDate): number {
  return toPlain(from).until(toPlain(to), { largestUnit: 'days' }).days;
}

/**
 * The instant at which a wall-clock time happens in `zone`. A time in a DST
 * gap (02:30 on spring-forward day) resolves to the later side; a repeated
 * time (01:30 on fall-back day) resolves to its first occurrence. Used for
 * floating iCalendar times, which carry no zone of their own.
 */
export function wallTimeToInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  zone: string,
): Date {
  // Validates the zone with the same rule as localDate (bare IANA name).
  toZoned(new Date(0), zone);
  const plain = Temporal.PlainDateTime.from({ year, month, day, hour, minute, second });
  return new Date(plain.toZonedDateTime(zone).epochMilliseconds);
}

/**
 * The half-open instant range `[start, end)` covering the inclusive local
 * dates `from` through `to` in `zone`: from the first instant of `from` to
 * the first instant of the day after `to`.
 */
export function localDateRangeToInstants(
  from: LocalDate,
  to: LocalDate,
  zone: string,
): { start: Date; end: Date } {
  return {
    start: firstInstantOf(from, zone),
    end: firstInstantOf(addDays(to, 1), zone),
  };
}

/** The first instant of the local day `date` in `zone` (00:00, or later if midnight is in a DST gap). */
export function firstInstantOf(date: LocalDate, zone: string): Date {
  toZoned(new Date(0), zone);
  return new Date(toPlain(date).toZonedDateTime({ timeZone: zone }).epochMilliseconds);
}
