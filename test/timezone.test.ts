import { describe, expect, it } from 'vitest';

describe('test environment', () => {
  it('runs in UTC whatever the host zone', () => {
    // A summer date: a host zone with DST would give a non-zero offset here
    // even if its winter offset happened to be zero (e.g. Europe/London).
    expect(new Date(Date.UTC(2026, 6, 1)).getTimezoneOffset()).toBe(0);
    expect(new Date(Date.UTC(2026, 0, 1)).getTimezoneOffset()).toBe(0);
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('UTC');
  });
});
