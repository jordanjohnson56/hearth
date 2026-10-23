import type { ClientFeature } from '../types.js';
import { ChoresAdmin } from './admin/ChoresAdmin.client.js';
import { ChoresPage } from './page/ChoresPage.client.js';
import { ChoresToday } from './tile/ChoresToday.client.js';

// The Leaderboard tile (M2.4) reads the same board.
export const choresClient = {
  id: 'chores',
  name: 'Chores',
  tile: { component: ChoresToday, size: 'wide' },
  page: { component: ChoresPage, icon: '🧹' },
  admin: { component: ChoresAdmin },
} satisfies ClientFeature;
