import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
import { loadConfig } from './config.js';

/** A fresh, empty directory for one test, removed afterwards. */
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hearth-config-'));
  onTestFinished(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

describe('loadConfig', () => {
  it('applies the .env.example defaults when nothing is set', () => {
    const cwd = tempDir();

    const result = loadConfig({}, { cwd });

    expect(result).toEqual({
      ok: true,
      config: {
        port: 4400,
        dataDir: join(cwd, 'data'),
        zone: 'America/Chicago',
        logLevel: 'info',
      },
    });
  });

  it('accepts a fully specified valid environment', () => {
    const dataDir = join(tempDir(), 'nested', 'hearth');

    const result = loadConfig(
      { PORT: '8080', DATA_DIR: dataDir, TZ: 'Europe/Paris', LOG_LEVEL: 'debug' },
      { cwd: '/' },
    );

    expect(result).toEqual({
      ok: true,
      config: { port: 8080, dataDir, zone: 'Europe/Paris', logLevel: 'debug' },
    });
  });

  it('creates DATA_DIR when it does not exist yet', () => {
    const dataDir = join(tempDir(), 'fresh');

    loadConfig({ DATA_DIR: dataDir }, { cwd: '/' });

    expect(existsSync(dataDir)).toBe(true);
  });

  it('treats empty strings as missing', () => {
    const cwd = tempDir();

    const result = loadConfig(
      { PORT: '', DATA_DIR: '', TZ: '', LOG_LEVEL: '' },
      { cwd },
    );

    expect(result).toEqual({
      ok: true,
      config: {
        port: 4400,
        dataDir: join(cwd, 'data'),
        zone: 'America/Chicago',
        logLevel: 'info',
      },
    });
  });

  it.each(['0', '65536', '-1', '80.5', 'abc', ' 80', '1e3'])(
    'rejects PORT=%j',
    (port) => {
      const result = loadConfig({ PORT: port }, { cwd: tempDir() });

      expect(result).toEqual({
        ok: false,
        errors: [`PORT must be an integer from 1 to 65535 (got "${port}").`],
      });
    },
  );

  it.each(['1', '65535'])('accepts the PORT boundary %s', (port) => {
    const result = loadConfig({ PORT: port }, { cwd: tempDir() });

    expect(result.ok && result.config.port).toBe(Number(port));
  });

  it.each(['Mars/Olympus_Mons', 'Chicago', '+05:00', 'not a zone'])(
    'rejects the unknown zone TZ=%j',
    (zone) => {
      const result = loadConfig({ TZ: zone }, { cwd: tempDir() });

      expect(result).toEqual({
        ok: false,
        errors: [
          `TZ must be a valid IANA time zone such as America/Chicago (got "${zone}").`,
        ],
      });
    },
  );

  it.each(['UTC', 'America/Chicago', 'Asia/Kolkata'])('accepts TZ=%s', (zone) => {
    const result = loadConfig({ TZ: zone }, { cwd: tempDir() });

    expect(result.ok && result.config.zone).toBe(zone);
  });

  it('rejects an unknown LOG_LEVEL', () => {
    const result = loadConfig({ LOG_LEVEL: 'verbose' }, { cwd: tempDir() });

    expect(result).toEqual({
      ok: false,
      errors: [
        'LOG_LEVEL must be one of fatal, error, warn, info, debug, trace, silent (got "verbose").',
      ],
    });
  });

  it('rejects a DATA_DIR that is an existing file', () => {
    const file = join(tempDir(), 'hearth.db');
    writeFileSync(file, '');

    const result = loadConfig({ DATA_DIR: file }, { cwd: '/' });

    expect(result).toEqual({
      ok: false,
      errors: [
        `DATA_DIR must be a directory Hearth can create and write to: ${file} cannot be created (EEXIST).`,
      ],
    });
  });

  it('rejects a DATA_DIR that cannot be created under a file', () => {
    const file = join(tempDir(), 'plain-file');
    writeFileSync(file, '');
    const dataDir = join(file, 'data');

    const result = loadConfig({ DATA_DIR: dataDir }, { cwd: '/' });

    expect(result).toEqual({
      ok: false,
      errors: [
        `DATA_DIR must be a directory Hearth can create and write to: ${dataDir} cannot be created (ENOTDIR).`,
      ],
    });
  });

  // Root ignores directory permissions, so this check cannot fail as root.
  it.skipIf(process.getuid?.() === 0)('rejects a DATA_DIR that is not writable', () => {
    const dataDir = tempDir();
    chmodSync(dataDir, 0o500);
    onTestFinished(() => {
      chmodSync(dataDir, 0o700);
    });

    const result = loadConfig({ DATA_DIR: dataDir }, { cwd: '/' });

    expect(result).toEqual({
      ok: false,
      errors: [
        `DATA_DIR must be a directory Hearth can create and write to: ${dataDir} is not writable (EACCES).`,
      ],
    });
  });

  it('reports every invalid variable at once, in a stable order', () => {
    const result = loadConfig(
      { PORT: 'abc', TZ: 'Nowhere/Land', LOG_LEVEL: 'loud' },
      { cwd: tempDir() },
    );

    expect(result).toEqual({
      ok: false,
      errors: [
        'PORT must be an integer from 1 to 65535 (got "abc").',
        'TZ must be a valid IANA time zone such as America/Chicago (got "Nowhere/Land").',
        'LOG_LEVEL must be one of fatal, error, warn, info, debug, trace, silent (got "loud").',
      ],
    });
  });
});
