import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { onTestFinished } from 'vitest';
import type { AppOptions } from '../../src/server/app.js';
import type { Config } from '../../src/server/config.js';
import { captureLogger } from './logger.js';

/** The fixture SPA build (test/fixtures/client-dist). */
export const fixtureClientDist = fileURLToPath(
  new URL('../fixtures/client-dist', import.meta.url),
);

/**
 * A valid Config whose DATA_DIR is a fresh temp directory, removed when the
 * test finishes. Call inside a test.
 */
export function testConfig(overrides: Partial<Config> = {}): Config {
  const dataDir = mkdtempSync(join(tmpdir(), 'hearth-data-'));
  onTestFinished(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });
  return {
    port: 4400,
    dataDir,
    zone: 'America/Chicago',
    logLevel: 'info',
    ...overrides,
  };
}

/**
 * Options for createApp: fixture client, test config and an in-memory logger.
 * Override any field. Call inside a test.
 */
export function testAppOptions(overrides: Partial<AppOptions> = {}): AppOptions {
  return {
    clientDist: fixtureClientDist,
    config: testConfig(),
    logger: captureLogger().logger,
    ...overrides,
  };
}
