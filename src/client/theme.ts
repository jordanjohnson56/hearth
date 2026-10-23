// The theme switch on the client: the household's switch times, fetched at
// load and on the backstop, evaluated on every minute tick and written to
// <html data-theme>, which theme.css honors. Held in a small store rather
// than React state so the admin panel can apply a saved edit at once
// without the App re-fetching.
import { useEffect, useSyncExternalStore } from 'react';
import { DEFAULT_THEME_TIMES, evaluateTheme, isThemeTimes } from '../core/theme.js';
import type { Theme, ThemeTimes } from '../core/theme.js';
import { registerBackstop } from './liveUpdates.js';
import { useNow } from './useNow.js';

export const THEME_URL = '/api/settings/theme';

let current: ThemeTimes = DEFAULT_THEME_TIMES;
const listeners = new Set<() => void>();

/** The switch times in use: the defaults until the first fetch resolves. */
export function themeTimes(): ThemeTimes {
  return current;
}

/**
 * Replaces the switch times in use. The admin panel calls this with what
 * the server answered to a save, so the editing device flips at once.
 */
export function setThemeTimes(times: ThemeTimes): void {
  if (times.lightFrom === current.lightFrom && times.darkFrom === current.darkFrom) return;
  current = times;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The switch times in use, re-rendering when they change. */
export function useThemeTimes(): ThemeTimes {
  return useSyncExternalStore(subscribe, themeTimes);
}

/**
 * Reloads the switch times from the server. A failed or malformed answer
 * leaves the times in use alone: the wall keeps switching on the last
 * known pair (or the defaults) until the next backstop. Unlike readJson
 * (http.ts), the body is checked first: a malformed pair would throw on
 * every minute tick, so this one response is not taken on trust.
 */
export async function fetchThemeTimes(): Promise<void> {
  try {
    const res = await fetch(THEME_URL);
    if (!res.ok) return;
    const body: unknown = await res.json();
    if (isThemeTimes(body)) setThemeTimes(body);
  } catch {
    // Offline or mid-restart: the backstop tries again.
  }
}

/**
 * Keeps <html data-theme> current for `zone`: fetches the times on mount
 * and on every backstop, and re-evaluates on each minute tick. Mount once,
 * at the app root. Returns the theme in effect.
 */
export function useTheme(zone: string): Theme {
  const now = useNow();
  const times = useThemeTimes();
  const theme = evaluateTheme(now, zone, times);

  useEffect(() => {
    void fetchThemeTimes();
    return registerBackstop(() => {
      void fetchThemeTimes();
    });
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return theme;
}
