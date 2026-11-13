import { describe, expect, it } from 'vitest';
import { easterSunday, holidayLabel, holidaysBetween, holidaysByDate, nthWeekday } from './holidays.js';

const labelsBetween = (first: string, last: string) =>
  holidaysBetween(first, last).map((holiday) => `${holiday.date} ${holidayLabel(holiday)}`);

describe('holidaysBetween', () => {
  it('lists 2026 in date order, with the Saturday Independence Day observed on Friday', () => {
    expect(
      holidaysBetween('2026-01-01', '2026-12-31')
        .filter((holiday) => holiday.kind === 'federal')
        .map((holiday) => `${holiday.date} ${holidayLabel(holiday)}`),
    ).toEqual([
      "2026-01-01 New Year's Day",
      '2026-01-19 Martin Luther King Jr. Day',
      "2026-02-16 Presidents' Day",
      '2026-05-25 Memorial Day',
      '2026-06-19 Juneteenth',
      '2026-07-03 Independence Day (observed)',
      '2026-07-04 Independence Day',
      '2026-09-07 Labor Day',
      '2026-10-12 Columbus Day',
      '2026-11-11 Veterans Day',
      '2026-11-26 Thanksgiving',
      '2026-12-25 Christmas Day',
    ]);
  });

  it('includes the observances that are not days off', () => {
    expect(
      holidaysBetween('2026-01-01', '2026-12-31')
        .filter((holiday) => holiday.kind === 'observance')
        .map((holiday) => `${holiday.date} ${holiday.name}`),
    ).toEqual([
      "2026-02-14 Valentine's Day",
      "2026-03-17 St. Patrick's Day",
      '2026-04-05 Easter',
      "2026-05-10 Mother's Day",
      "2026-06-21 Father's Day",
      '2026-10-31 Halloween',
      '2026-12-24 Christmas Eve',
      "2026-12-31 New Year's Eve",
    ]);
  });

  it('moves a Sunday holiday to Monday and a Saturday one to Friday', () => {
    // 2027: Juneteenth is a Saturday, Independence Day a Sunday.
    expect(labelsBetween('2027-06-18', '2027-07-05')).toEqual([
      '2027-06-18 Juneteenth (observed)',
      '2027-06-19 Juneteenth',
      "2027-06-20 Father's Day",
      '2027-07-04 Independence Day',
      '2027-07-05 Independence Day (observed)',
    ]);
  });

  it('puts a federal day before an observance on the same date', () => {
    // Christmas 2027 is a Saturday, observed on Christmas Eve.
    expect(labelsBetween('2027-12-24', '2027-12-25')).toEqual([
      '2027-12-24 Christmas Day (observed)',
      '2027-12-24 Christmas Eve',
      '2027-12-25 Christmas Day',
    ]);
  });

  it("observes a Saturday New Year's Day on December 31 of the year before", () => {
    // January 1, 2028 is a Saturday; the range never reaches 2028.
    expect(labelsBetween('2027-12-31', '2027-12-31')).toEqual([
      "2027-12-31 New Year's Day (observed)",
      "2027-12-31 New Year's Eve",
    ]);
    expect(labelsBetween('2028-01-01', '2028-01-01')).toEqual(["2028-01-01 New Year's Day"]);
  });

  it('has no Juneteenth before 2021 and no Martin Luther King Jr. Day before 1986', () => {
    expect(labelsBetween('2020-06-19', '2020-06-19')).toEqual([]);
    expect(labelsBetween('2021-06-18', '2021-06-19')).toEqual([
      '2021-06-18 Juneteenth (observed)',
      '2021-06-19 Juneteenth',
    ]);
    expect(labelsBetween('1985-01-01', '1985-01-31')).toEqual(["1985-01-01 New Year's Day"]);
    expect(labelsBetween('1986-01-20', '1986-01-20')).toEqual(['1986-01-20 Martin Luther King Jr. Day']);
  });

  it('covers a range that spans years, like a January grid starting in December', () => {
    expect(labelsBetween('2025-12-28', '2026-01-03')).toEqual([
      "2025-12-31 New Year's Eve",
      "2026-01-01 New Year's Day",
    ]);
  });

  it('is empty for an inverted range', () => {
    expect(holidaysBetween('2026-12-31', '2026-01-01')).toEqual([]);
  });
});

describe('holidaysByDate', () => {
  it('groups by date in holidaysBetween order', () => {
    const byDate = holidaysByDate('2027-12-20', '2027-12-26');
    expect([...byDate.keys()]).toEqual(['2027-12-24', '2027-12-25']);
    expect(byDate.get('2027-12-24')?.map(holidayLabel)).toEqual(['Christmas Day (observed)', 'Christmas Eve']);
  });
});

describe('nthWeekday', () => {
  it('finds the nth and the last weekday of a month', () => {
    // November 2026 starts on a Sunday.
    expect(nthWeekday(2026, 11, 0, 1)).toBe('2026-11-01');
    expect(nthWeekday(2026, 11, 4, 4)).toBe('2026-11-26');
    // May 2026 ends on a Sunday, so its last Monday is the 25th.
    expect(nthWeekday(2026, 5, 1, -1)).toBe('2026-05-25');
    // May 2027 ends on a Monday.
    expect(nthWeekday(2027, 5, 1, -1)).toBe('2027-05-31');
  });
});

describe('easterSunday', () => {
  it.each([
    [2024, '2024-03-31'],
    [2025, '2025-04-20'],
    [2026, '2026-04-05'],
    [2027, '2027-03-28'],
    [2038, '2038-04-25'], // latest possible
    [2285, '2285-03-22'], // earliest possible
  ])('%i is %s', (year, date) => {
    expect(easterSunday(year)).toBe(date);
  });
});
