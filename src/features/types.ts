// The feature contract, shared by the server and client halves of every
// feature. Type declarations only: every import is `import type`, so this
// module never pulls Express into the browser bundle or React into the
// server. ESLint rejects value imports and value declarations here.
import type { Database } from 'better-sqlite3';
import type { RequestHandler, Router } from 'express';
import type { Logger } from 'pino';
import type { FC } from 'react';
import type { Broadcaster } from '../server/broadcaster.js';
import type { Config } from '../server/config.js';

export type FeatureId = 'calendar' | 'chores';

export interface Migration {
  id: number;
  name: string;
  sql: string;
}

/**
 * What the app factory hands a feature's router and job factories once the
 * database is migrated. A feature reaches the database, the live-update hub,
 * the clock and the network only through here, so a test can inject a
 * clock and a fake network.
 */
export interface FeatureContext {
  db: Database;
  /** Publish the feature's own id here when its data changed. */
  broadcaster: Broadcaster;
  logger: Logger;
  config: Config;
  /** The current instant. Tests inject a fixed clock. */
  now: () => Date;
  /** Outbound HTTP. Tests inject fixture responses and failures. */
  fetch: typeof globalThis.fetch;
  /** Core's bearer-token middleware; put it in front of every admin route. */
  requireAdmin: RequestHandler;
}

/** A recurring job the scheduler runs once after listen and then every `intervalMs`. */
export interface FeatureJob {
  /** For log lines. */
  name: string;
  intervalMs: number;
  run(): Promise<void>;
}

export interface ServerFeature {
  id: FeatureId;
  name: string;
  /** The feature's own tables, numbered from 1 within the feature. */
  migrations: readonly Migration[];
  /** Called after migrations; the router is mounted at /api/<id>. */
  createRouter?(ctx: FeatureContext): Router;
  /** Called after migrations; the job is handed to the scheduler. */
  createJob?(ctx: FeatureContext): FeatureJob;
}

export interface ClientFeature {
  id: FeatureId;
  name: string;
  tile?: { component: FC; size: 'sm' | 'wide' };
  page?: { component: FC; icon: string };
  /**
   * The feature's admin panel, rendered by the core /admin route below the
   * core panel once unlocked. It calls bearer routes through the admin
   * session (src/client/admin/session.tsx).
   */
  admin?: { component: FC };
}
