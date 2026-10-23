import { useEffect, useRef } from 'react';
import { useFeatureData } from '../../client/useFeatureData.js';
import type { FeatureData } from '../../client/useFeatureData.js';
import { useNow } from '../../client/useNow.js';
import { configuredZone } from '../../client/zone.js';
import { localDateOf } from '../../core/localDateText.js';
import { fetchBoard } from './api.client.js';
import type { BoardResponse } from './types.js';

const zone = configuredZone();

/**
 * The chores board for a tile or page: fetched on mount, on every `chores`
 * hint and on the 5-minute backstop (useFeatureData), and again when the
 * local date turns, so the pool rolls over at midnight without a reload.
 * The board carries its own states; the client's date only decides when
 * to ask again.
 */
export function useBoard(): FeatureData<BoardResponse> {
  const today = localDateOf(useNow(), zone);
  const board = useFeatureData('chores', fetchBoard);
  const { refetch } = board;

  const fetchedFor = useRef(today);
  useEffect(() => {
    if (fetchedFor.current === today) return;
    fetchedFor.current = today;
    refetch();
  }, [today, refetch]);

  return board;
}
