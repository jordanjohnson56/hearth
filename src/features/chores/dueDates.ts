// Due-date expansion for a recurrence rule (docs/adr/0005): pure local-date
// arithmetic, with no times and no zones. "Today" is the boundary's job
// (the configured zone's local date of the injected now).
import { addDays, addMonths, daysBetween, endOfMonth, startOfMonth, weekdayOf } from '../../core/time.js';
import type { LocalDate } from '../../core/time.js';
import { WEEKDAYS } from './rule.js';
import type { RecurrenceRule } from './rule.js';

/**
 * The due dates of `rule` from `start` through `through`, both included,
 * in order. Empty for a whenever rule and when `start` is after `through`.
 */
export function dueDates(rule: RecurrenceRule, start: LocalDate, through: LocalDate): LocalDate[] {
  switch (rule.kind) {
    case 'daily':
      return stepping(start, through, 1);
    case 'every':
      return stepping(start, through, stepDays(rule));
    case 'weekly': {
      const isoDays = new Set(rule.days.map((day) => WEEKDAYS.indexOf(day) + 1));
      return stepping(start, through, 1).filter((date) => isoDays.has(weekdayOf(date)));
    }
    case 'monthly':
      return monthly(rule.day, start, through);
    case 'whenever':
      return [];
  }
}

/**
 * The first due date of `rule` (counted from `start`) on or after `from`,
 * or undefined for a whenever rule. Same dates as `dueDates`, found without
 * walking from the start date, so a chore started years ago costs no more.
 */
export function nextDueDate(rule: RecurrenceRule, start: LocalDate, from: LocalDate): LocalDate | undefined {
  const first = from > start ? from : start;
  switch (rule.kind) {
    case 'daily':
      return first;
    case 'every': {
      const step = stepDays(rule);
      const steps = Math.ceil(daysBetween(start, first) / step);
      return addDays(start, steps * step);
    }
    case 'weekly':
      // Some chosen weekday falls within any seven days.
      return dueDates(rule, first, addDays(first, 6))[0];
    case 'monthly':
      // The day (or the month's last day) falls in this month or the next.
      return monthly(rule.day, first, endOfMonth(addMonths(startOfMonth(first), 1)))[0];
    case 'whenever':
      return undefined;
  }
}

function stepDays(rule: Extract<RecurrenceRule, { kind: 'every' }>): number {
  return rule.unit === 'weeks' ? rule.interval * 7 : rule.interval;
}

function stepping(start: LocalDate, through: LocalDate, step: number): LocalDate[] {
  const dates: LocalDate[] = [];
  for (let date = start; date <= through; date = addDays(date, step)) dates.push(date);
  return dates;
}

function monthly(day: number, start: LocalDate, through: LocalDate): LocalDate[] {
  const dates: LocalDate[] = [];
  for (let first = startOfMonth(start); first <= through; first = addMonths(first, 1)) {
    const last = endOfMonth(first);
    const lastDay = Number(last.slice(8));
    const date = (day >= lastDay ? last : `${first.slice(0, 8)}${String(day).padStart(2, '0')}`) as LocalDate;
    if (date >= start && date <= through) dates.push(date);
  }
  return dates;
}
