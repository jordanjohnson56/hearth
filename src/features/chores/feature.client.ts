import type { ClientFeature } from '../types.js';
import { ChoresAdmin } from './admin/ChoresAdmin.client.js';

// No tile or page yet (M2.3): the admin panel defines the chores.
export const choresClient = {
  id: 'chores',
  name: 'Chores',
  admin: { component: ChoresAdmin },
} satisfies ClientFeature;
