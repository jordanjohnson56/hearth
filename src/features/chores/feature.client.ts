import type { ClientFeature } from '../types.js';
import { ChoresAdmin } from './admin/ChoresAdmin.client.js';
import { ChoresToday } from './tile/ChoresToday.client.js';
import { Leaderboard } from './tile/Leaderboard.client.js';

// Both tiles and the page (M2.5) read the same board.
export const choresClient = {
  id: 'chores',
  name: 'Chores',
  tiles: [
    { component: ChoresToday, size: 'wide' },
    { component: Leaderboard, size: 'sm' },
  ],
  admin: { component: ChoresAdmin },
} satisfies ClientFeature;
