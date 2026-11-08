/**
 * Formats `instant` as a wall-clock time (`7:42 AM`, locale-dependent) in
 * `zone`, whatever the device's own zone: an event's start or end. `locale`
 * defaults to the runtime's. Throws RangeError for an unknown zone.
 */
export function formatTime(instant: Date, zone: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(instant);
}
