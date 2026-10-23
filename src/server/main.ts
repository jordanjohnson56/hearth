// Server entrypoint: the only server module that reads process.env. It loads
// and validates the bootstrap config, refuses to start on any problem, and
// hands config and logger to the app factory.
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import { serverFeatureList } from '../features/registry.server.js';
import { createApp } from './app.js';
import { createBroadcaster } from './broadcaster.js';
import { loadConfig } from './config.js';
import { prepareDatabase } from './db/database.js';
import { createLogger } from './logger.js';
import { startScheduler } from './scheduler.js';
import type { Scheduler } from './scheduler.js';

const result = loadConfig(process.env, { cwd: process.cwd() });

if (!result.ok) {
  // No logger yet (LOG_LEVEL may be the bad value), so plain stderr, one
  // problem per line, all of them at once.
  process.stderr.write(
    `Hearth cannot start: invalid configuration.\n${result.errors
      .map((error) => `  - ${error}\n`)
      .join('')}See .env.example for the expected values.\n`,
  );
  process.exit(1);
}

const { config } = result;
const logger = createLogger(config.logLevel);

// Migrate before listening. A failed migration has rolled back; refuse to
// start rather than serve against a half-migrated schema.
let db: Database.Database;
try {
  const prepared = prepareDatabase(config.dataDir, serverFeatureList, new Date());
  db = prepared.db;
  logger.info(
    { applied: prepared.applied.map((m) => `${m.scope}#${String(m.id)} ${m.name}`) },
    'database ready',
  );
} catch (error) {
  logger.fatal({ err: error }, 'cannot prepare the database');
  process.exit(1);
}

// Built layout: dist/server/main.js next to dist/client (vite build).
// Under `npm run dev` this points at src/client, which Vite serves instead;
// open the Vite URL in development.
const clientDist = fileURLToPath(new URL('../client', import.meta.url));

// One hub for the process: M1's poll jobs and M2's writes publish to it.
const broadcaster = createBroadcaster(logger);

const { app, jobs } = createApp({ clientDist, config, logger, db, broadcaster });

// Jobs start once the server is listening, so a slow first poll never
// delays the first request.
let scheduler: Scheduler | undefined;
const server = app.listen(config.port, (error?: Error) => {
  if (error !== undefined) {
    logger.fatal({ err: error, port: config.port }, 'cannot listen');
    process.exit(1);
  }
  logger.info(
    { port: config.port, zone: config.zone, dataDir: config.dataDir },
    'Hearth listening',
  );
  scheduler = startScheduler(jobs, logger);
});

/** How long in-flight requests get to finish before their sockets are cut. */
const SHUTDOWN_GRACE_MS = 5_000;

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    logger.info({ signal }, 'shutting down');
    // No new job runs; one in progress finishes within the grace period or
    // is lost with the process, which the next boot's run makes good.
    scheduler?.stop();
    // Stop accepting connections (idle keep-alive ones close now), then end
    // the event streams, which never finish on their own: without that,
    // close() waits until Docker's SIGKILL and the database is never closed.
    server.close(() => {
      db.close();
      process.exit(0);
    });
    broadcaster.close();
    // Anything still open after the grace period is cut.
    setTimeout(() => {
      server.closeAllConnections();
    }, SHUTDOWN_GRACE_MS).unref();
  });
}
