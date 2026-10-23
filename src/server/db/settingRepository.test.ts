import { describe, expect, it } from 'vitest';
import { tempDatabase } from '../../../test/helpers/sqlite.js';
import { runMigrations } from './migrate.js';
import { migrationSets } from './schema.js';
import { readSetting, writeSetting } from './settingRepository.js';

function migratedDatabase() {
  const { db } = tempDatabase();
  runMigrations(db, migrationSets([]), new Date('2026-10-23T12:00:00Z'));
  return db;
}

describe('settings', () => {
  it('reads a key nobody has written as absent', () => {
    const db = migratedDatabase();

    expect(readSetting(db, 'theme.lightFrom')).toBeUndefined();
  });

  it('reads back what was written', () => {
    const db = migratedDatabase();

    writeSetting(db, 'theme.lightFrom', '07:00');

    expect(readSetting(db, 'theme.lightFrom')).toBe('07:00');
  });

  it('overwrites an existing value in place', () => {
    const db = migratedDatabase();
    writeSetting(db, 'theme.lightFrom', '07:00');

    writeSetting(db, 'theme.lightFrom', '06:30');

    expect(readSetting(db, 'theme.lightFrom')).toBe('06:30');
  });

  it('keeps keys apart', () => {
    const db = migratedDatabase();
    writeSetting(db, 'theme.lightFrom', '07:00');
    writeSetting(db, 'theme.darkFrom', '20:00');

    expect(readSetting(db, 'theme.lightFrom')).toBe('07:00');
    expect(readSetting(db, 'theme.darkFrom')).toBe('20:00');
  });

  it('stores the empty string as a value, distinct from absent', () => {
    const db = migratedDatabase();

    writeSetting(db, 'admin.pinHash', '');

    expect(readSetting(db, 'admin.pinHash')).toBe('');
  });
});
