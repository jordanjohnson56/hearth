// Seed entrypoint (`npm run seed`): like main.ts, it is an entrypoint and may
// read process.env. It uses the same config loader, so it seeds the same
// DATA_DIR the server uses (/data in the container). Pending migrations are
// applied first; see seedDataDir.
import { serverFeatureList } from '../features/registry.server.js';
import { loadConfig } from './config.js';
import { seedDataDir } from './db/seed.js';
import { createLogger } from './logger.js';

const result = loadConfig(process.env, { cwd: process.cwd() });

if (!result.ok) {
  process.stderr.write(
    `Hearth cannot seed: invalid configuration.\n${result.errors
      .map((error) => `  - ${error}\n`)
      .join('')}See .env.example for the expected values.\n`,
  );
  process.exit(1);
}

const { config } = result;
const logger = createLogger(config.logLevel);

try {
  const { applied, people, features } = seedDataDir(config.dataDir, serverFeatureList, new Date(), config.zone);
  logger.info(
    {
      dataDir: config.dataDir,
      applied: applied.map((m) => `${m.scope}#${String(m.id)} ${m.name}`),
      people: people.map((p) => p.displayName),
      features: Object.fromEntries(features.map((f) => [f.id, f.seeded])),
    },
    'seeded the fictional family and the demo data',
  );
} catch (error) {
  logger.fatal({ err: error }, 'cannot seed the database');
  process.exit(1);
}
