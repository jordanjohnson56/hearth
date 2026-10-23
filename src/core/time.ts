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
