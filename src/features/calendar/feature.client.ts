import type { ClientFeature } from '../types.js';
import { CalendarAdmin } from './admin/CalendarAdmin.client.js';
import { DayAtAGlance } from './tile/DayAtAGlance.client.js';

// The month page lands with its own ticket.
export const calendarClient = {
  id: 'calendar',
  name: 'Calendar',
  tile: { component: DayAtAGlance, size: 'sm' },
  admin: { component: CalendarAdmin },
} satisfies ClientFeature;
