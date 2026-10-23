import { calendarClient } from './calendar/feature.client.js';
import { choresClient } from './chores/feature.client.js';
import type { ClientFeature, FeatureId } from './types.js';

// Mirrors registry.server.ts: every FeatureId exactly once, each under its
// own id, or it does not typecheck. Key order is nav order.
export const clientFeatures = {
  calendar: calendarClient,
  chores: choresClient,
} satisfies { [K in FeatureId]: ClientFeature & { id: K } };

export const clientFeatureList: readonly ClientFeature[] =
  Object.values(clientFeatures);
