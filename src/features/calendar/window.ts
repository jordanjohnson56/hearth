// The local-date window a poll keeps occurrences for. Pure: `now` and the
// zone are parameters, as in the core.
import { addMonths, endOfMonth, localDate, startOfMonth } from '../../core/time.js';
import type { LocalDate } from '../../core/time.js';
import { MONTHS_AHEAD, MONTHS_BACK } from './windowSize.js';

/** Inclusive local dates. */
export interface DateWindow {
  from: LocalDate;
  to: LocalDate;
}

/**
 * The first day of the month three months before `now` through the last day
 * of the month twelve months after it, as local dates in `zone`. Recomputed
 * on every poll, so the window slides with the calendar.
 */
export function pollWindow(now: Date, zone: string): DateWindow {
  const today = localDate(now, zone);
  return {
    from: startOfMonth(addMonths(today, -MONTHS_BACK)),
    to: endOfMonth(addMonths(today, MONTHS_AHEAD)),
  };
}
