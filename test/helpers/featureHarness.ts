// The feature server test harness: an app with the PIN set and unlocked,
// the given features, an injected clock that tests move with `advance`, a
// capturing logger and every change hint recorded in order.
import type { Database } from 'better-sqlite3';
import type { Express } from 'express';
import type { ServerFeature } from '../../src/features/types.js';
import { createApp } from '../../src/server/app.js';
import type { AppOptions } from '../../src/server/app.js';
import { createBroadcaster } from '../../src/server/broadcaster.js';
import { setPinAndUnlock } from './admin.js';
import { testAppOptions } from './app.js';
import { captureLogger } from './logger.js';

export interface FeatureHarness {
  app: Express;
  db: Database;
  /** A live admin bearer token. The admin session lapses after 10 idle minutes of the injected clock. */
  token: string;
  /** Every published change hint, in order. */
  hints: string[];
  lines: () => Record<string, unknown>[];
  text: () => string;
  /** Moves the injected clock forward. */
  advance: (ms: number) => void;
}

/** Call inside a test. `overrides` may replace `now`, which then ignores `advance`. */
export async function featureHarness(
  features: readonly ServerFeature[],
  start: Date,
  overrides: Partial<AppOptions> = {},
): Promise<FeatureHarness> {
  const { logger, lines, text } = captureLogger();
  const broadcaster = createBroadcaster(logger);
  const hints: string[] = [];
  broadcaster.subscribe((feature) => hints.push(feature));
  let at = start.getTime();
  const options = testAppOptions({
    features,
    logger,
    broadcaster,
    now: () => new Date(at),
    ...overrides,
  });
  const { app } = createApp(options);
  const token = await setPinAndUnlock(app);
  return {
    app,
    db: options.db,
    token,
    hints,
    lines,
    text,
    advance: (ms) => {
      at += ms;
    },
  };
}
