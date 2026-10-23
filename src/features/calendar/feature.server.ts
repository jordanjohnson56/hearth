import type { ServerFeature } from '../types.js';

// Stub until M1: no migrations, router or job yet.
export const calendarServer = {
  id: 'calendar',
  name: 'Calendar',
  migrations: [],
} satisfies ServerFeature;
