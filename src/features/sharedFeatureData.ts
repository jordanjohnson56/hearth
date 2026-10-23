// One feature request shared by every mounted consumer, where useFeatureData
// gives each its own: the Home tiles and the Chores page read one board, so
// a hint sends one request and every tile shows the same snapshot. Kept free
// of React and the DOM so it is tested under Node; a client hook subscribes
// with useSyncExternalStore (useBoard.client.ts).
import type { FeatureData, FeatureId } from './types.js';

/** The useSyncExternalStore pair, and one consumer's start and stop. */
export interface SharedFeatureData<T> {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => FeatureData<T>;
  /**
   * Starts one consumer. The first one fetches and registers for hints;
   * a `key` other than the last fetch's fetches again (the local date
   * turning). Returns the stop; the last stop unregisters and aborts.
   */
  connect: (key: string) => () => void;
}

/** `register` is liveUpdates' registerRefetcher, passed in so this module stays off the DOM. */
export function sharedFeatureData<T>(
  featureId: FeatureId,
  fetcher: (signal: AbortSignal) => Promise<T>,
  register: (feature: FeatureId, refetch: () => void) => () => void,
): SharedFeatureData<T> {
  const listeners = new Set<() => void>();
  let consumers = 0;
  let unregister: (() => void) | undefined;
  let inFlight: AbortController | undefined;
  let fetchedFor: string | undefined;

  const refetch = (): void => {
    inFlight?.abort();
    const controller = new AbortController();
    inFlight = controller;
    fetcher(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) update({ data, error: undefined, fetchedAt: new Date() });
      },
      (err: unknown) => {
        if (!controller.signal.aborted) update({ error: err instanceof Error ? err.message : 'Request failed' });
      },
    );
  };

  let snapshot: FeatureData<T> = { data: undefined, error: undefined, fetchedAt: undefined, refetch };
  const update = (change: Partial<FeatureData<T>>): void => {
    snapshot = { ...snapshot, ...change };
    for (const listener of listeners) listener();
  };

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    connect: (key) => {
      consumers += 1;
      if (consumers === 1) unregister = register(featureId, refetch);
      if (consumers === 1 || key !== fetchedFor) {
        fetchedFor = key;
        refetch();
      }
      return () => {
        consumers -= 1;
        if (consumers > 0) return;
        unregister?.();
        unregister = undefined;
        inFlight?.abort();
      };
    },
  };
}
