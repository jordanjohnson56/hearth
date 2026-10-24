import { describe, expect, it } from 'vitest';
import { completedText, nextDueText } from './pageText.js';

// ICU may put a narrow no-break space before AM/PM; compare on plain spaces.
const plain = (text: string) => text.replace(/\s/g, ' ');

// Friday 2026-10-23 in Chicago, as the board's `today` says.
const TODAY = '2026-10-23';

describe('nextDueText', () => {
  it('says "Tomorrow" for the day after today', () => {
    expect(nextDueText('2026-10-24', TODAY, 'en-US')).toBe('Tomorrow');
  });

  it.each([
    ['2026-10-25', 'Sunday'],
    ['2026-10-29', 'Thursday'],
  ])('names the weekday of %s, within the next six days', (nextDue, text) => {
    expect(nextDueText(nextDue, TODAY, 'en-US')).toBe(text);
  });

  it('gives the weekday, month and day a week or more ahead', () => {
    expect(nextDueText('2026-10-30', TODAY, 'en-US')).toBe('Fri, Oct 30');
    expect(nextDueText('2026-11-30', TODAY, 'en-US')).toBe('Mon, Nov 30');
  });

  it('adds the year when it is not this year', () => {
    expect(nextDueText('2027-01-04', TODAY, 'en-US')).toBe('Mon, Jan 4, 2027');
  });

  it('counts across the end of DST like any other day (November 1, 2026)', () => {
    expect(nextDueText('2026-11-01', '2026-10-31', 'en-US')).toBe('Tomorrow');
    expect(nextDueText('2026-11-02', '2026-10-31', 'en-US')).toBe('Monday');
  });
});

describe('completedText', () => {
  const zone = 'America/Chicago';

  it('gives today\'s completion its time as the header clock writes it', () => {
    // 12:05 CDT.
    expect(plain(completedText(new Date('2026-10-23T17:05:00Z').getTime(), TODAY, zone, 'en-US'))).toBe(
      'Today, 12:05 PM',
    );
  });

  it('reads the day in the configured zone, not UTC', () => {
    // Saturday 03:00 UTC is still Friday 10 PM in Chicago.
    expect(plain(completedText(new Date('2026-10-24T03:00:00Z').getTime(), TODAY, zone, 'en-US'))).toBe(
      'Today, 10:00 PM',
    );
  });

  it('says "Yesterday" for the day before', () => {
    expect(plain(completedText(new Date('2026-10-22T23:30:00Z').getTime(), TODAY, zone, 'en-US'))).toBe(
      'Yesterday, 6:30 PM',
    );
  });

  it('names the weekday for earlier in the week, Monday midnight included', () => {
    // Monday 2026-10-19 00:00 CDT: the first instant of the week.
    expect(plain(completedText(new Date('2026-10-19T05:00:00Z').getTime(), TODAY, zone, 'en-US'))).toBe(
      'Monday, 12:00 AM',
    );
  });
});
