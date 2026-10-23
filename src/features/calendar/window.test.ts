import { describe, expect, it } from 'vitest';
import { pollWindow } from './window.js';

const CHICAGO = 'America/Chicago';

describe('pollWindow', () => {
  it('runs from the first of the month three months back through the last of the month twelve ahead', () => {
    expect(pollWindow(new Date('2026-10-23T12:00:00Z'), CHICAGO)).toEqual({
      from: '2026-07-01',
      to: '2027-10-31',
    });
  });

  it('is computed from the local date in the zone, not the UTC date', () => {
    // 2026-11-01 03:00Z is still the evening of Oct 31 in Chicago.
    expect(pollWindow(new Date('2026-11-01T03:00:00Z'), CHICAGO)).toEqual({
      from: '2026-07-01',
      to: '2027-10-31',
    });
    expect(pollWindow(new Date('2026-11-01T03:00:00Z'), 'UTC')).toEqual({
      from: '2026-08-01',
      to: '2027-11-30',
    });
  });

  it('ends on the 29th in a leap-year February', () => {
    expect(pollWindow(new Date('2027-02-15T12:00:00Z'), 'UTC').to).toBe('2028-02-29');
  });
});
