import { describe, expect, it } from 'vitest';
import type { LocalDate } from '../../core/time.js';
import { digestOf } from './digest.js';
import type { CalendarEvent } from './types.js';

const dentist: CalendarEvent = {
  sourceId: 1,
  uid: 'dentist@cal.example',
  recurrenceId: null,
  title: 'Ada dentist',
  location: 'Oak Street Dental',
  kind: 'timed',
  startAt: new Date('2026-10-24T14:00:00Z'),
  endAt: new Date('2026-10-24T15:30:00Z'),
};

const noSchool: CalendarEvent = {
  sourceId: 1,
  uid: 'no-school@cal.example',
  recurrenceId: null,
  title: 'Linus no school',
  location: null,
  kind: 'allDay',
  startDate: '2026-10-25' as LocalDate,
  endDate: '2026-10-26' as LocalDate,
};

describe('digestOf', () => {
  it('is sha256 of an empty list for no events (computed outside this code)', () => {
    expect(digestOf([])).toBe('4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945');
  });

  it('does not depend on the order of the events', () => {
    expect(digestOf([dentist, noSchool])).toBe(digestOf([noSchool, dentist]));
  });

  it('differs for a different set', () => {
    expect(digestOf([dentist])).not.toBe(digestOf([dentist, noSchool]));
  });

  it.each<[string, CalendarEvent]>([
    ['the source', { ...dentist, sourceId: 2 }],
    ['the uid', { ...dentist, uid: 'dentist-2@cal.example' }],
    ['the recurrence id', { ...dentist, recurrenceId: '20261024T090000' }],
    ['the title', { ...dentist, title: 'Ada dentist (moved)' }],
    ['the location', { ...dentist, location: null }],
    ['the start', { ...dentist, startAt: new Date('2026-10-24T14:30:00Z') }],
    ['the end', { ...dentist, endAt: new Date('2026-10-24T16:00:00Z') }],
    ['the kind', { ...noSchool, uid: dentist.uid, title: dentist.title, location: dentist.location }],
    ['an all-day end date', { ...noSchool, endDate: '2026-10-27' as LocalDate }],
  ])('changes when %s changes', (_label, changed) => {
    expect(digestOf([dentist, noSchool])).not.toBe(digestOf([changed, noSchool]));
  });

  it('ignores a stored row id, which changes on every replace', () => {
    expect(digestOf([{ ...dentist, id: 1 } as CalendarEvent])).toBe(digestOf([{ ...dentist, id: 7 } as CalendarEvent]));
  });
});
