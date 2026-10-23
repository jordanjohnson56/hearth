// The household's zone, as the server injected it into index.html
// (src/server/index-html.ts writes <meta name="hearth-zone">; keep the name
// in sync). Under `npm run dev` the Vite plugin in vite.config.ts injects it
// from the same config loader.

// Only a guard for a missing or mangled meta tag: the server injects a zone
// its config loader already checked with the core's isValidZone
// (src/core/time.ts). Kept on Intl, which the clock uses anyway, so the
// client bundle does not pull in the Temporal polyfill for one check.
function isKnownZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The configured zone, or the browser's own zone when the page was served
 * without one (e.g. `vite preview`). The fallback keeps the clock running
 * instead of crashing the shell; the server always injects in production.
 */
export function configuredZone(): string {
  const injected = document
    .querySelector<HTMLMetaElement>('meta[name="hearth-zone"]')
    ?.content.trim();
  if (injected && isKnownZone(injected)) return injected;
  return new Intl.DateTimeFormat().resolvedOptions().timeZone;
}
