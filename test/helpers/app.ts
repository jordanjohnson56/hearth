import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Express } from 'express';
import { onTestFinished } from 'vitest';
import { serverFeatureList } from '../../src/features/registry.server.js';
import type { ServerFeature } from '../../src/features/types.js';
import { createApp } from '../../src/server/app.js';
import type { AppOptions } from '../../src/server/app.js';
import type { Config } from '../../src/server/config.js';
import { runMigrations } from '../../src/server/db/migrate.js';
import { migrationSets } from '../../src/server/db/schema.js';
import { captureLogger } from './logger.js';
import { tempDatabase } from './sqlite.js';

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
 * Options for createApp: fixture client, test config, an in-memory logger
 * and a throwaway database migrated for the features given (the registry's
 * by default). Override any field. Call inside a test.
 */
export function testAppOptions(overrides: Partial<AppOptions> = {}): AppOptions {
  return {
    clientDist: fixtureClientDist,
    config: testConfig(),
    logger: captureLogger().logger,
    db: overrides.db ?? migratedTempDatabase(overrides.features ?? serverFeatureList),
    ...overrides,
  };
}

/** The Express app from createApp(testAppOptions(overrides)), for tests that need nothing else. */
export function testApp(overrides: Partial<AppOptions> = {}): Express {
  return createApp(testAppOptions(overrides)).app;
}

function migratedTempDatabase(features: readonly ServerFeature[]): AppOptions['db'] {
  const { db } = tempDatabase();
  runMigrations(db, migrationSets(features), new Date());
  return db;
}
