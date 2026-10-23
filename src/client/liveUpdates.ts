import { useEffect } from 'react';
import { decodeChangeHint } from '../core/changeHint.js';
import { clientFeatureList } from '../features/registry.client.js';
import type { FeatureId } from '../features/types.js';

/** The server's stream of change hints (Server-Sent Events). */
export const EVENTS_URL = '/api/events';

/**
 * Every feature refetches on this interval whatever the stream says: the
 * backstop for hints missed while a connection was down (iPad Safari drops
 * it when the screen sleeps).
 */
export const BACKSTOP_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Wait before reopening a stream the browser gave up on. The browser retries
 * a dropped connection by itself, but stops for good when an attempt gets an
 * HTTP error (a dev proxy's 5xx while the server restarts, for one).
 */
export const RECONNECT_DELAY_MS = 5 * 1000;

/** Reloads one feature's data from /api/<id>. */
export type Refetcher = () => void;

const refetchers = new Map<FeatureId, Set<Refetcher>>();

/**
 * Registers `refetch` to run when `feature` changes, and on every backstop
 * or reconnect refetch. Returns the function that unregisters it; call it
 * from the registering effect's cleanup.
 */
export function registerRefetcher(feature: FeatureId, refetch: Refetcher): () => void {
  let set = refetchers.get(feature);
  if (!set) {
    set = new Set();
    refetchers.set(feature, set);
  }
  // Wrapped so that registering the same function twice runs it twice and
  // each unregister removes only its own entry.
  const entry: Refetcher = () => {
    refetch();
  };
  set.add(entry);
  return () => {
    set.delete(entry);
  };
}

/**
 * Core reloads that ride the backstop and reconnect refetches but belong to
 * no feature (the theme times). Change hints stay FeatureId-only, so these
 * are never triggered by a hint.
 */
const backstops = new Set<Refetcher>();

/**
 * Registers `refetch` to run on every backstop or reconnect refetch, as
 * `registerRefetcher` does, but for core data no change hint names.
 * Returns the function that unregisters it.
 */
export function registerBackstop(refetch: Refetcher): () => void {
  const entry: Refetcher = () => {
    refetch();
  };
  backstops.add(entry);
  return () => {
    backstops.delete(entry);
  };
}

function refetchFeature(feature: FeatureId): void {
  for (const refetch of refetchers.get(feature) ?? []) refetch();
}

function refetchAll(): void {
  for (const feature of refetchers.keys()) refetchFeature(feature);
  for (const refetch of backstops) refetch();
}

/**
 * Keeps registered refetchers current: listens on the change-hint stream,
 * reopens it after a drop, refetches everything after each reconnect (hints
 * may have been missed meanwhile) and on the backstop interval. Mount once,
 * at the app root.
 */
export function useLiveUpdates(): void {
  useEffect(() => {
    const ids = clientFeatureList.map((feature) => feature.id);
    let source: EventSource | undefined;
    let reconnectTimer: number | undefined;
    let opened = false;

    const connect = (): void => {
      const current = new EventSource(EVENTS_URL);
      source = current;
      current.addEventListener('open', () => {
        if (opened) refetchAll();
        opened = true;
      });
      current.addEventListener('message', (event: MessageEvent<string>) => {
        const feature = decodeChangeHint(event.data, ids);
        if (feature) refetchFeature(feature);
      });
      current.addEventListener('error', () => {
        // CONNECTING means the browser is already retrying; CLOSED means it
        // gave up, so retry ourselves.
        if (current.readyState !== EventSource.CLOSED) return;
        current.close();
        reconnectTimer = window.setTimeout(connect, RECONNECT_DELAY_MS);
      });
    };

    connect();
    const backstop = window.setInterval(refetchAll, BACKSTOP_INTERVAL_MS);

    return () => {
      window.clearInterval(backstop);
      window.clearTimeout(reconnectTimer);
      source?.close();
    };
  }, []);
}
