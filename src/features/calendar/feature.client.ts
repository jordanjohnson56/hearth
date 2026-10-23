import type { ClientFeature } from '../types.js';
import { CalendarAdmin } from './admin/CalendarAdmin.client.js';

// The tile and the month page land with their own tickets.
export const calendarClient = {
  id: 'calendar',
  name: 'Calendar',
  admin: { component: CalendarAdmin },
} satisfies ClientFeature;
