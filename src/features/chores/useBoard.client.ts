import { useEffect, useSyncExternalStore } from 'react';
import { registerRefetcher } from '../../client/liveUpdates.js';
import { useNow } from '../../client/useNow.js';
import { configuredZone } from '../../client/zone.js';
import { localDateOf } from '../../core/localDateText.js';
import { sharedFeatureData } from '../sharedFeatureData.js';
import type { FeatureData } from '../types.js';
import { fetchBoard } from './api.client.js';
import type { BoardResponse } from './types.js';

const zone = configuredZone();

const board = sharedFeatureData('chores', fetchBoard, registerRefetcher);

/**
 * The chores board for a tile or page: one request and one snapshot shared
 * by every mounted reader, fetched on mount, on every `chores` hint and on
 * the 5-minute backstop, and again when the local date turns, so the pool
 * rolls over at midnight without a reload. The board carries its own
 * states; the client's date only decides when to ask again.
 */
export function useBoard(): FeatureData<BoardResponse> {
  const today = localDateOf(useNow(), zone);
  const data = useSyncExternalStore(board.subscribe, board.getSnapshot);
  useEffect(() => board.connect(today), [today]);
  return data;
}
