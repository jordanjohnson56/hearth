import { describe, expect, it } from 'vitest';
import { parseRule } from './rule.js';

describe('parseRule', () => {
  it.each([
    ['daily', { kind: 'daily' }],
    ['weekly on one day', { kind: 'weekly', days: ['sat'] }],
    ['weekly on every day of the week', { kind: 'weekly', days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] }],
    ['every 2 days', { kind: 'every', unit: 'days', interval: 2 }],
    ['every 3 weeks', { kind: 'every', unit: 'weeks', interval: 3 }],
    ['monthly on the 1st', { kind: 'monthly', day: 1 }],
    ['monthly on the 31st', { kind: 'monthly', day: 31 }],
    ['whenever', { kind: 'whenever' }],
  ])('accepts %s', (_label, value) => {
    expect(parseRule(value)).toEqual({ ok: true, rule: value });
  });

  it('puts weekdays in week order, Monday first', () => {
    expect(parseRule({ kind: 'weekly', days: ['sat', 'mon', 'thu'] })).toEqual({
      ok: true,
      rule: { kind: 'weekly', days: ['mon', 'thu', 'sat'] },
    });
  });

  it.each([
    ['an empty weekday set', { kind: 'weekly', days: [] }, 'Choose at least one weekday'],
    ['a weekly rule without days', { kind: 'weekly' }, 'Choose at least one weekday'],
    ['a weekday that is not a token', { kind: 'weekly', days: ['monday'] }, 'Weekdays must be mon, tue, wed, thu, fri, sat or sun'],
    ['a repeated weekday', { kind: 'weekly', days: ['mon', 'mon'] }, 'Each weekday may appear once'],
    ['every with interval 1', { kind: 'every', unit: 'days', interval: 1 }, 'The interval must be a whole number of 2 or more (use daily or weekly for 1)'],
    ['every with interval 0', { kind: 'every', unit: 'weeks', interval: 0 }, 'The interval must be a whole number of 2 or more (use daily or weekly for 1)'],
    ['every with a fractional interval', { kind: 'every', unit: 'days', interval: 2.5 }, 'The interval must be a whole number of 2 or more (use daily or weekly for 1)'],
    ['every with the interval as text', { kind: 'every', unit: 'days', interval: '3' }, 'The interval must be a whole number of 2 or more (use daily or weekly for 1)'],
    ['every with an unknown unit', { kind: 'every', unit: 'months', interval: 2 }, 'The unit must be days or weeks'],
    ['monthly day 0', { kind: 'monthly', day: 0 }, 'The day of the month must be a whole number from 1 to 31'],
    ['monthly day 32', { kind: 'monthly', day: 32 }, 'The day of the month must be a whole number from 1 to 31'],
    ['monthly without a day', { kind: 'monthly' }, 'The day of the month must be a whole number from 1 to 31'],
    ['an unknown kind', { kind: 'yearly' }, 'The rule must be daily, weekly, every, monthly or whenever'],
    ['a missing kind', {}, 'The rule must be daily, weekly, every, monthly or whenever'],
    ['a string', 'daily', 'The rule must be daily, weekly, every, monthly or whenever'],
    ['null', null, 'The rule must be daily, weekly, every, monthly or whenever'],
    ['an array', [{ kind: 'daily' }], 'The rule must be daily, weekly, every, monthly or whenever'],
    ['a field the kind does not have', { kind: 'daily', days: ['mon'] }, 'A daily rule has no field "days"'],
    ['a stray field on every', { kind: 'every', unit: 'days', interval: 2, anchor: '2026-01-01' }, 'An every rule has no field "anchor"'],
  ])('rejects %s', (_label, value, message) => {
    expect(parseRule(value)).toEqual({ ok: false, message });
  });
});
