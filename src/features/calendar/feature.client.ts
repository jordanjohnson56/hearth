import type { ClientFeature } from '../types.js';
import { CalendarAdmin } from './admin/CalendarAdmin.client.js';
import { MonthPage } from './page/MonthPage.client.js';

// The tile lands with its own ticket.
export const calendarClient = {
  id: 'calendar',
  name: 'Calendar',
  page: { component: MonthPage, icon: '📅' },
  admin: { component: CalendarAdmin },
} satisfies ClientFeature;
