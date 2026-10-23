import type { ReactNode } from 'react';
import { formatClock } from '../core/clock.js';
import { clientFeatureList } from '../features/registry.client.js';
import type { ClientFeature } from '../features/types.js';
import { AdminPage } from './admin/AdminPage.js';
import { AdminSessionProvider } from './admin/session.js';
import { useLiveUpdates } from './liveUpdates.js';
import { useTheme } from './theme.js';
import { followLink, useRoute } from './router.js';
import type { Route } from './router.js';
import { useNow } from './useNow.js';
import { configuredZone } from './zone.js';

const zone = configuredZone();

type TileSize = 'sm' | 'wide';

// Dashed placeholders for future features (DESIGN section 7), after the real
// tiles. The mockup shows one wide slot and four small ones; the calendar
// tile took the first small one, so three small ghosts remain.
const GHOST_SLOTS: readonly TileSize[] = ['wide', 'sm', 'sm', 'sm'];

export function App() {
  useLiveUpdates();
  useTheme(zone);
  const { path, route } = useRoute();

  // The admin session sits above the router so an unlocked admin stays
  // unlocked across in-app navigation; a reload still drops it.
  return (
    <AdminSessionProvider>
      <div className="shell">
        <Header onAdmin={route.kind === 'admin'} />
        <main className="shell-main">
          <View route={route} />
        </main>
        <BottomNav path={path} />
      </div>
    </AdminSessionProvider>
  );
}

function Header({ onAdmin }: { onAdmin: boolean }) {
  const now = useNow();
  const { time, date } = formatClock(now, zone);

  return (
    <header className="shell-header">
      <p className="clock">
        <time className="clock-part" dateTime={now.toISOString()}>
          {time}
        </time>
        <span className="clock-part">{date}</span>
      </p>
      <a
        className="admin-button"
        href="/admin"
        onClick={followLink}
        aria-current={onAdmin ? 'page' : undefined}
      >
        Admin
      </a>
    </header>
  );
}

function View({ route }: { route: Route }) {
  switch (route.kind) {
    case 'home':
      return <Home />;
    case 'admin':
      return <AdminPage />;
    case 'feature':
      return <FeaturePage feature={route.feature} />;
    case 'not-found':
      return (
        <EmptyState title="Page not found">
          <a className="link-button" href="/" onClick={followLink}>
            Go to Home
          </a>
        </EmptyState>
      );
  }
}

function Home() {
  const tiles = clientFeatureList.flatMap((feature) => (feature.tile ? [{ feature, tile: feature.tile }] : []));

  return (
    <section className="home-grid" aria-label="Home">
      {tiles.map(({ feature, tile: { component: Tile, size } }) => (
        <div key={feature.id} className="tile" data-size={size}>
          <Tile />
        </div>
      ))}
      {GHOST_SLOTS.map((size, index) => (
        <div key={index} className="tile tile-ghost" data-size={size} aria-hidden="true">
          Space for a future tile
        </div>
      ))}
    </section>
  );
}

function FeaturePage({ feature }: { feature: ClientFeature }) {
  if (feature.page) {
    const Page = feature.page.component;
    return <Page />;
  }
  return (
    <EmptyState title={feature.name}>
      <p>Nothing here yet. This page fills in when {feature.name} is built.</p>
    </EmptyState>
  );
}

function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="empty-state">
      <h1 className="empty-state-title">{title}</h1>
      {children}
    </section>
  );
}

function BottomNav({ path }: { path: string }) {
  const items = [
    { href: '/', label: 'Home', icon: '⌂' },
    ...clientFeatureList.map((feature) => ({
      href: `/${feature.id}`,
      label: feature.name,
      icon: feature.page?.icon ?? '•',
    })),
  ];
  const current = (href: string) =>
    href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`);

  return (
    <nav className="bottom-nav" aria-label="Main">
      {items.map((item) => (
        <a
          key={item.href}
          className="nav-item"
          href={item.href}
          onClick={followLink}
          aria-current={current(item.href) ? 'page' : undefined}
        >
          <span className="nav-icon" aria-hidden="true">
            {item.icon}
          </span>
          {item.label}
        </a>
      ))}
    </nav>
  );
}
