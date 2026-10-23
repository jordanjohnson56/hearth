import { calendarServer } from './calendar/feature.server.js';
import { choresServer } from './chores/feature.server.js';
import type { FeatureId, ServerFeature } from './types.js';

// Must cover every FeatureId exactly once, each under its own id; anything
// else is a type error. registry.client.ts mirrors this. There is no runtime
// cross-check: importing the client registry here would pull in React.
// Registry order is also migration order (core first, then these).
export const serverFeatures = {
  calendar: calendarServer,
  chores: choresServer,
} satisfies { [K in FeatureId]: ServerFeature & { id: K } };

export const serverFeatureList: readonly ServerFeature[] =
  Object.values(serverFeatures);
