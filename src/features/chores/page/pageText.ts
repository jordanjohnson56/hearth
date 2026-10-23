// Dates and times as the Chores page writes them. Polyfill-free: local
// dates are `YYYY-MM-DD` text worked with the core's local-date text
// helpers, and a time is the header clock's format (formatTime).
import { formatTime } from '../../../core/clock.js';
import { addDays, localDateOf, partsOf } from '../../../core/localDateText.js';

/** A `YYYY-MM-DD` at UTC midnight: printed in UTC, it names that day whatever the device's zone. */
function atUtcMidnight(date: string): Date {
  const { year, month, day } = partsOf(date);
  return new Date(Date.UTC(year, month - 1, day));
}

/**
 * When an upcoming chore is next due, from the board's `today`:
 * "Tomorrow", the weekday within the next six days ("Sunday"), else the
 * weekday, month and day ("Mon, Nov 30"), with the year when it is not
 * this year's.
 */
export function nextDueText(nextDue: string, today: string, locale?: string): string {
  if (nextDue === addDays(today, 1)) return 'Tomorrow';
  const day = atUtcMidnight(nextDue);
  if (nextDue <= addDays(today, 6)) {
    return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'long' }).format(day);
  }
  const sameYear = partsOf(nextDue).year === partsOf(today).year;
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(day);
}

/**
 * When a completion of this week happened, in `zone`: "Today, 7:42 AM",
 * "Yesterday, 6:30 PM", else the weekday ("Monday, 8:00 AM"). The time is
 * written as the header clock writes it.
 */
export function completedText(completedAt: number, today: string, zone: string, locale?: string): string {
  const instant = new Date(completedAt);
  const time = formatTime(instant, zone, locale);
  const date = localDateOf(instant, zone);
  if (date === today) return `Today, ${time}`;
  if (date === addDays(today, -1)) return `Yesterday, ${time}`;
  const weekday = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'long' }).format(atUtcMidnight(date));
  return `${weekday}, ${time}`;
}
