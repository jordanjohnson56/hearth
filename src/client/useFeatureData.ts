import { useCallback, useEffect, useRef, useState } from 'react';
import type { FeatureData, FeatureId } from '../features/types.js';
import { registerRefetcher } from './liveUpdates.js';

/**
 * A feature's data: fetched on mount, again on every change hint for
 * `featureId` and on the 5-minute backstop, and on demand. A fetch still
 * in flight when the next starts is aborted, so results never arrive out
 * of order. `fetcher` gets the abort signal to pass to fetch. A page whose
 * request follows the URL (the month grid) passes the part that varies as
 * `key`: a change of key fetches again, like mounting afresh.
 */
export function useFeatureData<T>(
  featureId: FeatureId,
  fetcher: (signal: AbortSignal) => Promise<T>,
  key?: string,
): FeatureData<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [fetchedAt, setFetchedAt] = useState<Date | undefined>(undefined);
  // The latest fetcher, so a caller may pass an inline closure without
  // restarting the effect on every render.
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });
  const inFlight = useRef<AbortController | undefined>(undefined);

  const refetch = useCallback(() => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    fetcherRef.current(controller.signal).then(
      (result) => {
        if (controller.signal.aborted) return;
        setData(result);
        setError(undefined);
        setFetchedAt(new Date());
      },
      (err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Request failed');
      },
    );
  }, []);

  useEffect(() => {
    refetch();
    const unregister = registerRefetcher(featureId, refetch);
    return () => {
      unregister();
      inFlight.current?.abort();
    };
  }, [featureId, key, refetch]);

  return { data, error, fetchedAt, refetch };
}
