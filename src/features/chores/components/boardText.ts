// Board wording the tiles and the Chores page share.
import type { WaitingChoreWire } from '../types.js';

export function latenessText(chore: WaitingChoreWire): string | undefined {
  if (chore.state !== 'overdue') return undefined;
  return chore.daysLate === 1 ? '1 day late' : `${String(chore.daysLate)} days late`;
}

export function pointsText(points: number): string {
  return points === 1 ? '1 pt' : `${String(points)} pts`;
}
