// The recurrence rule (docs/adr/0005): Hearth's own five kinds, one way to
// say each thing, stored as JSON text in chore.rule and checked here on
// every write and every read. Kept free of the Temporal polyfill so the
// client can import it (test/clientBundle.test.ts); the due-date expansion
// lives in dueDates.ts.

/** Weekday tokens in week order, Monday first (the scoring week's order). */
export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const RULE_KINDS = ['daily', 'weekly', 'every', 'monthly', 'whenever'] as const;
export type RuleKind = (typeof RULE_KINDS)[number];

export type RecurrenceRule =
  /** Every date. */
  | { kind: 'daily' }
  /** The given weekdays, in week order, at least one. */
  | { kind: 'weekly'; days: Weekday[] }
  /** start + k·interval days, or start + k·interval weeks (so on the start date's weekday); interval ≥ 2. */
  | { kind: 'every'; unit: 'days' | 'weeks'; interval: number }
  /** That day of every month, clamped to the month's last day. */
  | { kind: 'monthly'; day: number }
  /** No due dates: an anytime chore. */
  | { kind: 'whenever' };

export type RuleCheck = { ok: true; rule: RecurrenceRule } | { ok: false; message: string };

/** The fields each kind may carry besides `kind`. */
const FIELDS: Record<RuleKind, readonly string[]> = {
  daily: [],
  weekly: ['days'],
  every: ['unit', 'interval'],
  monthly: ['day'],
  whenever: [],
};

const KIND_MESSAGE = 'The rule must be daily, weekly, every, monthly or whenever';
const INTERVAL_MESSAGE = 'The interval must be a whole number of 2 or more (use daily or weekly for 1)';
const MONTH_DAY_MESSAGE = 'The day of the month must be a whole number from 1 to 31';

function isRuleKind(value: unknown): value is RuleKind {
  return typeof value === 'string' && (RULE_KINDS as readonly string[]).includes(value);
}

function isWeekday(value: unknown): value is Weekday {
  return typeof value === 'string' && (WEEKDAYS as readonly string[]).includes(value);
}

function isWholeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

/**
 * `value` (parsed JSON) as a rule in its one canonical form, or a message
 * written for the admin form. Unknown fields are refused rather than
 * dropped, so what is stored is exactly what was checked.
 */
export function parseRule(value: unknown): RuleCheck {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, message: KIND_MESSAGE };
  }
  const fields = value as Record<string, unknown>;
  const kind = fields['kind'];
  if (!isRuleKind(kind)) return { ok: false, message: KIND_MESSAGE };

  const stray = Object.keys(fields).find((key) => key !== 'kind' && !FIELDS[kind].includes(key));
  if (stray !== undefined) {
    const article = kind === 'every' ? 'An' : 'A';
    return { ok: false, message: `${article} ${kind} rule has no field ${JSON.stringify(stray)}` };
  }

  switch (kind) {
    case 'daily':
    case 'whenever':
      return { ok: true, rule: { kind } };
    case 'weekly':
      return parseWeekly(fields['days']);
    case 'every': {
      const unit = fields['unit'];
      if (unit !== 'days' && unit !== 'weeks') return { ok: false, message: 'The unit must be days or weeks' };
      const interval = fields['interval'];
      if (!isWholeNumber(interval) || interval < 2) return { ok: false, message: INTERVAL_MESSAGE };
      return { ok: true, rule: { kind, unit, interval } };
    }
    case 'monthly': {
      const day = fields['day'];
      if (!isWholeNumber(day) || day < 1 || day > 31) return { ok: false, message: MONTH_DAY_MESSAGE };
      return { ok: true, rule: { kind, day } };
    }
  }
}

function parseWeekly(days: unknown): RuleCheck {
  if (!Array.isArray(days) || days.length === 0) return { ok: false, message: 'Choose at least one weekday' };
  if (!days.every(isWeekday)) {
    return { ok: false, message: 'Weekdays must be mon, tue, wed, thu, fri, sat or sun' };
  }
  if (new Set(days).size !== days.length) return { ok: false, message: 'Each weekday may appear once' };
  return { ok: true, rule: { kind: 'weekly', days: WEEKDAYS.filter((day) => days.includes(day)) } };
}
