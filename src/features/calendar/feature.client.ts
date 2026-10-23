import type { ClientFeature } from '../types.js';
import { CalendarAdmin } from './admin/CalendarAdmin.client.js';
import { MonthPage } from './page/MonthPage.client.js';
import { DayAtAGlance } from './tile/DayAtAGlance.client.js';

export const calendarClient = {
  id: 'calendar',
  name: 'Calendar',
  tile: { component: DayAtAGlance, size: 'sm' },
  page: { component: MonthPage, icon: '📅' },
  admin: { component: CalendarAdmin },
} satisfies ClientFeature;
