import { describe, expect, it } from 'vitest';
import { formatTime } from './clock.js';

// ICU may put a narrow no-break space before AM/PM; compare on plain spaces.
function plain(time: string) {
  return time.replace(/\s/g, ' ');
}

describe('formatTime', () => {
  it('shows the configured zone, not the process zone (UTC under test)', () => {
    // 03:00 UTC on Oct 24 is still 10 PM on Oct 23 in Chicago (CDT, UTC-5).
    expect(plain(formatTime(new Date('2026-10-24T03:00:00Z'), 'America/Chicago', 'en-US'))).toBe('10:00 PM');
    expect(plain(formatTime(new Date('2026-10-24T03:00:00Z'), 'Asia/Kolkata', 'en-US'))).toBe('8:30 AM');
  });

  it('jumps from 1:59 to 3:00 when DST starts (March 8, 2026)', () => {
    expect(plain(formatTime(new Date('2026-03-08T07:59:00Z'), 'America/Chicago', 'en-US'))).toBe('1:59 AM');
    expect(plain(formatTime(new Date('2026-03-08T08:00:00Z'), 'America/Chicago', 'en-US'))).toBe('3:00 AM');
  });

  it('shows 1:30 twice when DST ends (November 1, 2026)', () => {
    expect(plain(formatTime(new Date('2026-11-01T06:30:00Z'), 'America/Chicago', 'en-US'))).toBe('1:30 AM');
    expect(plain(formatTime(new Date('2026-11-01T07:30:00Z'), 'America/Chicago', 'en-US'))).toBe('1:30 AM');
  });

  it('rejects an unknown zone instead of silently using the device zone', () => {
    expect(() => formatTime(new Date('2026-10-23T12:00:00Z'), 'Mars/Olympus_Mons', 'en-US')).toThrow(RangeError);
  });
});
