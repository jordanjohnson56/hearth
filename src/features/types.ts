// The feature contract, shared by the server and client halves of every
// feature. Type declarations only: every import is `import type`, so this
// module never pulls Express into the browser bundle or React into the
// server. ESLint rejects value imports and value declarations here.
import type { Router } from 'express';
import type { FC } from 'react';

export type FeatureId = 'calendar' | 'chores';

export interface Migration {
  id: number;
  name: string;
  sql: string;
}

export interface ServerFeature {
  id: FeatureId;
  name: string;
  /** The feature's own tables, numbered from 1 within the feature. */
  migrations: readonly Migration[];
  /** Mounted at /api/<id>. */
  router?: Router;
  job?: { intervalMs: number; run(): Promise<void> };
}

export interface ClientFeature {
  id: FeatureId;
  name: string;
  tile?: { component: FC; size: 'sm' | 'wide' };
  page?: { component: FC; icon: string };
}
