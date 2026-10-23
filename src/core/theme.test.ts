import { describe, expect, it } from 'vitest';
import { evaluateTheme, isHHMM, isThemeTimes, parseHHMM } from './theme.js';

const DEFAULTS = { lightFrom: '07:00', darkFrom: '19:30' };

describe('evaluateTheme', () => {
  it('is light at exactly lightFrom and dark the minute before', () => {
    expect(evaluateTheme(new Date('2026-10-23T07:00:00Z'), 'UTC', DEFAULTS)).toBe('light');
    expect(evaluateTheme(new Date('2026-10-23T06:59:59Z'), 'UTC', DEFAULTS)).toBe('dark');
  });

  it('is dark at exactly darkFrom and light the minute before, with chosen times', () => {
    const times = { lightFrom: '06:15', darkFrom: '21:05' };
    expect(evaluateTheme(new Date('2026-10-23T21:05:00Z'), 'UTC', times)).toBe('dark');
    expect(evaluateTheme(new Date('2026-10-23T21:04:59Z'), 'UTC', times)).toBe('light');
    expect(evaluateTheme(new Date('2026-10-23T06:14:00Z'), 'UTC', times)).toBe('dark');
  });

  it('accepts the times in either order: a dark morning and a light evening', () => {
    const times = { lightFrom: '20:00', darkFrom: '06:00' };
    const at = (iso: string) => evaluateTheme(new Date(iso), 'UTC', times);
    expect(at('2026-10-23T05:59:00Z')).toBe('light');
    expect(at('2026-10-23T06:00:00Z')).toBe('dark');
    expect(at('2026-10-23T19:59:00Z')).toBe('dark');
    expect(at('2026-10-23T20:00:00Z')).toBe('light');
    expect(at('2026-10-23T23:30:00Z')).toBe('light');
    expect(at('2026-10-24T00:30:00Z')).toBe('light');
  });

  it('wraps the default dark period across midnight', () => {
    expect(evaluateTheme(new Date('2026-10-23T23:59:00Z'), 'UTC', DEFAULTS)).toBe('dark');
    expect(evaluateTheme(new Date('2026-10-24T00:00:00Z'), 'UTC', DEFAULTS)).toBe('dark');
  });

  it('evaluates in the configured zone, not the process zone (UTC under test)', () => {
    // 03:00 UTC is noon in Tokyo: light there, dark on a UTC clock.
    const noonInTokyo = new Date('2026-10-23T03:00:00Z');
    expect(evaluateTheme(noonInTokyo, 'Asia/Tokyo', DEFAULTS)).toBe('light');
    expect(evaluateTheme(noonInTokyo, 'UTC', DEFAULTS)).toBe('dark');
  });

  it('switches at the end of a DST gap when lightFrom falls inside it', () => {
    // Chicago, 2026-03-08: the wall jumps from 01:59 CST to 03:00 CDT, so a
    // 02:30 lightFrom never shows on the clock that day. The theme is dark
    // through 01:59 and light from 03:00, the first wall minute at or after
    // the configured time: the switch is late by the gap, never skipped.
    const times = { lightFrom: '02:30', darkFrom: '19:30' };
    expect(evaluateTheme(new Date('2026-03-08T07:59:00Z'), 'America/Chicago', times)).toBe('dark');
    expect(evaluateTheme(new Date('2026-03-08T08:00:00Z'), 'America/Chicago', times)).toBe('light');
    // The day before, the same configured minute exists and switches on time.
    expect(evaluateTheme(new Date('2026-03-07T08:29:00Z'), 'America/Chicago', times)).toBe('dark');
    expect(evaluateTheme(new Date('2026-03-07T08:30:00Z'), 'America/Chicago', times)).toBe('light');
  });

  it('rejects an unknown zone instead of silently using the device zone', () => {
    expect(() => evaluateTheme(new Date(), 'Mars/Olympus_Mons', DEFAULTS)).toThrow(RangeError);
  });
});

describe('isHHMM', () => {
  it.each(['00:00', '07:00', '19:30', '23:59'])('accepts %s', (value) => {
    expect(isHHMM(value)).toBe(true);
  });

  it.each(['7:00', '24:00', '07:60', '0700', '07:00:00', ' 07:00', '', 700, null, undefined])(
    'rejects %j',
    (value) => {
      expect(isHHMM(value)).toBe(false);
    },
  );
});

describe('parseHHMM', () => {
  it('splits HH:MM into hour and minute numbers', () => {
    expect(parseHHMM('19:30')).toEqual({ hour: 19, minute: 30 });
    expect(parseHHMM('00:05')).toEqual({ hour: 0, minute: 5 });
  });

  it('throws RangeError for anything else', () => {
    expect(() => parseHHMM('7:00')).toThrow(RangeError);
  });
});

describe('isThemeTimes', () => {
  it('accepts two differing HH:MM times in either order', () => {
    expect(isThemeTimes({ lightFrom: '07:00', darkFrom: '19:30' })).toBe(true);
    expect(isThemeTimes({ lightFrom: '20:00', darkFrom: '06:00' })).toBe(true);
  });

  it.each([
    ['equal times', { lightFrom: '07:00', darkFrom: '07:00' }],
    ['a malformed time', { lightFrom: '7:00', darkFrom: '19:30' }],
    ['a missing field', { lightFrom: '07:00' }],
    ['a non-object', '07:00'],
    ['null', null],
  ])('rejects %s', (_name, value) => {
    expect(isThemeTimes(value)).toBe(false);
  });
});
