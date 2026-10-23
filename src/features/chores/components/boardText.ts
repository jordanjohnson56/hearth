// Board wording the tiles and the Chores page share.
import type { WaitingChoreWire } from '../types.js';

/** "1 day late", "3 days late"; undefined for a chore due today. */
export function lateness(chore: WaitingChoreWire): string | undefined {
  if (chore.state !== 'overdue') return undefined;
  return chore.daysLate === 1 ? '1 day late' : `${String(chore.daysLate)} days late`;
}

/** "1 pt", "5 pts". */
export function pointsText(points: number): string {
  return points === 1 ? '1 pt' : `${String(points)} pts`;
}
