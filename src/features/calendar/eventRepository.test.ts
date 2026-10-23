import { describe, expect, it } from 'vitest';
import { tempDatabase } from '../../../test/helpers/sqlite.js';
import { runMigrations } from '../../server/db/migrate.js';
import { migrationSets } from '../../server/db/schema.js';
import { listEventsOf, replaceEvents } from './eventRepository.js';
import { calendarServer } from './feature.server.js';

/** A migrated database with one source (id 1) and one of its timed events (id 1). */
function dbWithOneEvent() {
  const { db } = tempDatabase();
  runMigrations(db, migrationSets([calendarServer]), new Date());
  db.prepare(
    "INSERT INTO calendar_source (id, label, color, url_fingerprint, created_at) VALUES (1, 'Ada', 'ember', 'cal.example#0a0a0a0a', 0)",
  ).run();
  replaceEvents(db, 1, [
    {
      uid: 'dentist@cal.example',
      recurrenceId: null,
      title: 'Ada dentist',
      location: null,
      kind: 'timed',
      startAt: new Date('2026-10-24T14:00:00Z'),
      endAt: new Date('2026-10-24T15:30:00Z'),
    },
  ]);
  return db;
}

describe('listEventsOf', () => {
  it('round-trips a stored event', () => {
    expect(listEventsOf(dbWithOneEvent(), 1)).toMatchObject([
      { id: 1, sourceId: 1, kind: 'timed', startAt: new Date('2026-10-24T14:00:00Z'), title: 'Ada dentist' },
    ]);
  });

  it('refuses a row whose kind-specific columns are null instead of inventing a 1970 event', () => {
    const db = dbWithOneEvent();
    // The table CHECK forbids such a row; the pragma lets the test plant one.
    db.pragma('ignore_check_constraints = ON');
    db.prepare('UPDATE calendar_event SET end_at = NULL WHERE id = 1').run();

    expect(() => listEventsOf(db, 1)).toThrow(/calendar_event row 1 .*source 1/);
    expect(() => listEventsOf(db, 1)).not.toThrow(/dentist/);
  });
});
