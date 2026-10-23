// Server entrypoint: the only server module that reads process.env. It loads
// and validates the bootstrap config, refuses to start on any problem, and
// hands config and logger to the app factory.
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';

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

// Built layout: dist/server/main.js next to dist/client (vite build).
// Under `npm run dev` this points at src/client, which Vite serves instead;
// open the Vite URL in development.
const clientDist = fileURLToPath(new URL('../client', import.meta.url));

const app = createApp({ clientDist, config, logger });

const server = app.listen(config.port, (error?: Error) => {
  if (error !== undefined) {
    logger.fatal({ err: error, port: config.port }, 'cannot listen');
    process.exit(1);
  }
  logger.info(
    { port: config.port, zone: config.zone, dataDir: config.dataDir },
    'Hearth listening',
  );
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    logger.info({ signal }, 'shutting down');
    server.close(() => process.exit(0));
  });
}
