import { describe, expect, it } from 'vitest';
import { formatClock } from './clock.js';

// ICU may put a narrow no-break space before AM/PM; compare on plain spaces.
function plain(clock: { time: string; date: string }) {
  return { time: clock.time.replace(/\s/g, ' '), date: clock.date.replace(/\s/g, ' ') };
}

describe('formatClock', () => {
  it('shows the configured zone, not the process zone (UTC under test)', () => {
    // 03:00 UTC on Oct 24 is still 10 PM on Oct 23 in Chicago (CDT, UTC-5).
    expect(plain(formatClock(new Date('2026-10-24T03:00:00Z'), 'America/Chicago', 'en-US'))).toEqual({
      time: '10:00 PM',
      date: 'Friday, October 23',
    });
  });

  it('shows the same instant in a zone east of UTC on the next day', () => {
    expect(plain(formatClock(new Date('2026-10-23T20:15:00Z'), 'Asia/Kolkata', 'en-US'))).toEqual({
      time: '1:45 AM',
      date: 'Saturday, October 24',
    });
  });

  it('jumps from 1:59 to 3:00 when DST starts (March 8, 2026)', () => {
    expect(plain(formatClock(new Date('2026-03-08T07:59:00Z'), 'America/Chicago', 'en-US')).time).toBe('1:59 AM');
    expect(plain(formatClock(new Date('2026-03-08T08:00:00Z'), 'America/Chicago', 'en-US')).time).toBe('3:00 AM');
  });

  it('shows 1:30 twice when DST ends (November 1, 2026)', () => {
    expect(plain(formatClock(new Date('2026-11-01T06:30:00Z'), 'America/Chicago', 'en-US')).time).toBe('1:30 AM');
    expect(plain(formatClock(new Date('2026-11-01T07:30:00Z'), 'America/Chicago', 'en-US')).time).toBe('1:30 AM');
  });

  it('rejects an unknown zone instead of silently using the device zone', () => {
    expect(() => formatClock(new Date('2026-10-23T12:00:00Z'), 'Mars/Olympus_Mons', 'en-US')).toThrow(RangeError);
  });
});
