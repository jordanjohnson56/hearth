import type { FeatureId } from '../features/types.js';

/** Receives the id of a feature whose data changed. */
export type ChangeListener = (feature: FeatureId) => void;

/**
 * In-process publish/subscribe for live-update change hints. Poll jobs and
 * API writes publish the id of the feature they changed; each open
 * GET /api/events connection is one subscriber. A hint is only a FeatureId,
 * never data: clients refetch from /api/<id>.
 */
export interface Broadcaster {
  /** Tells every current subscriber that `feature`'s data changed. */
  publish(feature: FeatureId): void;
  /** Adds a subscriber. Returns its unsubscribe function. */
  subscribe(listener: ChangeListener): () => void;
  /** Number of current subscribers (open event streams). */
  readonly subscriberCount: number;
}

export function createBroadcaster(): Broadcaster {
  const listeners = new Set<ChangeListener>();
  return {
    publish(feature) {
      for (const listener of listeners) listener(feature);
    },
    subscribe(listener) {
      // Wrapped so that the same function subscribed twice counts twice.
      const entry: ChangeListener = (feature) => {
        listener(feature);
      };
      listeners.add(entry);
      return () => {
        listeners.delete(entry);
      };
    },
    get subscriberCount() {
      return listeners.size;
    },
  };
}
