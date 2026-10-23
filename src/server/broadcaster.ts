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
  /**
   * Adds a subscriber. `onClose` runs when the broadcaster closes (at
   * shutdown), so an event stream can end its response. Returns the
   * subscriber's unsubscribe function.
   */
  subscribe(listener: ChangeListener, onClose?: () => void): () => void;
  /**
   * Shutdown: runs every subscriber's `onClose` and drops them all. After
   * this, publish does nothing and a new subscriber is closed at once.
   */
  close(): void;
  /** Number of current subscribers (open event streams). */
  readonly subscriberCount: number;
}

interface Subscriber {
  listener: ChangeListener;
  onClose: (() => void) | undefined;
}

export function createBroadcaster(logger: Logger): Broadcaster {
  // An object per subscription, so the same function subscribed twice counts twice.
  const subscribers = new Set<Subscriber>();
  let closed = false;

  const runOnClose = (subscriber: Subscriber): void => {
    try {
      subscriber.onClose?.();
    } catch (err) {
      logger.warn({ err }, 'live-update subscriber failed to close');
    }
  };

  return {
    publish(feature) {
      // Iterate a copy: a failing subscriber is removed mid-loop.
      for (const subscriber of [...subscribers]) {
        try {
          subscriber.listener(feature);
        } catch (err) {
          subscribers.delete(subscriber);
          // The err serializer cuts any URL in the message down to its host.
          logger.warn({ err, feature }, 'dropped a live-update subscriber');
        }
      }
    },
    subscribe(listener, onClose) {
      const subscriber: Subscriber = { listener, onClose };
      if (closed) {
        runOnClose(subscriber);
        return () => undefined;
      }
      subscribers.add(subscriber);
      return () => {
        subscribers.delete(subscriber);
      };
    },
    close() {
      closed = true;
      const closing = [...subscribers];
      subscribers.clear();
      for (const subscriber of closing) runOnClose(subscriber);
    },
    get subscriberCount() {
      return subscribers.size;
    },
  };
}
