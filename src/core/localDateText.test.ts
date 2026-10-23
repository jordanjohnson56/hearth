import { describe, expect, it } from 'vitest';
import { addDays, localDateOf } from './localDateText.js';

describe('localDateOf', () => {
  it('is the wall-calendar date in the zone, not the UTC date', () => {
    // 2026-10-24 03:30Z is still the evening of Oct 23 in Chicago (CDT).
    const instant = new Date('2026-10-24T03:30:00Z');
    expect(localDateOf(instant, 'America/Chicago')).toBe('2026-10-23');
    expect(localDateOf(instant, 'UTC')).toBe('2026-10-24');
    expect(localDateOf(instant, 'Asia/Tokyo')).toBe('2026-10-24');
  });
});

describe('addDays', () => {
  it('crosses month and year ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
  });

  it('knows February in a leap year', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
  });

  it('adds zero and many days', () => {
    expect(addDays('2026-10-23', 0)).toBe('2026-10-23');
    expect(addDays('2026-10-23', 365)).toBe('2027-10-23');
  });
});
