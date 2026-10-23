import { useSyncExternalStore } from 'react';
import type { MouseEvent } from 'react';
import { clientFeatureList } from '../features/registry.client.js';
import type { ClientFeature } from '../features/types.js';

/** The view a path shows. Home is `/`; each feature page is `/<id>`. */
export type Route =
  | { kind: 'home' }
  | { kind: 'feature'; feature: ClientFeature }
  | { kind: 'not-found' };

const NAVIGATE_EVENT = 'hearth:navigate';

function routeFor(pathname: string): Route {
  // Only the first segment picks the view; deeper paths belong to the page.
  const [first] = pathname.split('/').filter(Boolean);
  if (first === undefined) return { kind: 'home' };
  const feature = clientFeatureList.find((candidate) => candidate.id === first);
  return feature ? { kind: 'feature', feature } : { kind: 'not-found' };
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange);
  window.addEventListener(NAVIGATE_EVENT, onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(NAVIGATE_EVENT, onChange);
  };
}

function currentPath(): string {
  return window.location.pathname;
}

/** The current route; re-renders on back/forward and on in-app links. */
export function useRoute(): { path: string; route: Route } {
  const path = useSyncExternalStore(subscribe, currentPath);
  return { path, route: routeFor(path) };
}

/**
 * Click handler for in-app links: a plain left click changes the route
 * without a page load; modified clicks (new tab etc.) behave as normal links.
 */
export function followLink(event: MouseEvent<HTMLAnchorElement>): void {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return;
  }
  const link = event.currentTarget;
  if (link.origin !== window.location.origin) return;
  event.preventDefault();
  // Query and fragment included: `/calendar?view=week` from `/calendar` is
  // a navigation, and pushState must keep them.
  const target = link.pathname + link.search + link.hash;
  const { pathname, search, hash } = window.location;
  if (target !== pathname + search + hash) {
    window.history.pushState(null, '', target);
    window.dispatchEvent(new Event(NAVIGATE_EVENT));
  }
}
