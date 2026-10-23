import type { ClientFeature } from '../types.js';
import { ChoresAdmin } from './admin/ChoresAdmin.client.js';
import { ChoresToday } from './tile/ChoresToday.client.js';

// The page (M2.5) and the Leaderboard tile (M2.4) read the same board.
export const choresClient = {
  id: 'chores',
  name: 'Chores',
  tile: { component: ChoresToday, size: 'wide' },
  admin: { component: ChoresAdmin },
} satisfies ClientFeature;
