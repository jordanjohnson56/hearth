import type { FeatureId } from '../features/types.js';
import type { Logger } from './logger.js';

/** Receives the id of a feature whose data changed. */
export type ChangeListener = (feature: FeatureId) => void;

/**
 * In-process publish/subscribe for live-update change hints. Poll jobs and
 * API writes publish the id of the feature they changed; each open
 * GET /api/events connection is one subscriber. A hint is only a FeatureId,
 * never data: clients refetch from /api/<id>.
 */
export interface Broadcaster {
  /**
   * Tells every current subscriber that `feature`'s data changed. Never
   * throws: a subscriber that throws (e.g. its socket is gone) is dropped
   * and logged at warn, and the others still get the hint.
   */
  publish(feature: FeatureId): void;
  /** Adds a subscriber. Returns its unsubscribe function. */
  subscribe(listener: ChangeListener): () => void;
  /** Number of current subscribers (open event streams). */
  readonly subscriberCount: number;
}

export function createBroadcaster(logger: Logger): Broadcaster {
  const listeners = new Set<ChangeListener>();
  return {
    publish(feature) {
      // Iterate a copy: a failing listener is removed mid-loop.
      for (const listener of [...listeners]) {
        try {
          listener(feature);
        } catch (err) {
          listeners.delete(listener);
          // The err serializer cuts any URL in the message down to its host.
          logger.warn({ err, feature }, 'dropped a live-update subscriber');
        }
      }
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
