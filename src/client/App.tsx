import { Circle, House, Settings } from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';
import { clientFeatureList } from '../features/registry.client.js';
import type { ClientFeature, FeatureTile } from '../features/types.js';
import { AdminPage } from './admin/AdminPage.js';
import { AdminSessionProvider, useAdminSession } from './admin/session.js';
import { useLiveUpdates } from './liveUpdates.js';
import { useTheme } from './theme.js';
import { followLink, useRoute } from './router.js';
import type { Route } from './router.js';
import { configuredZone } from './zone.js';

const zone = configuredZone();

// Dashed placeholders for future features (DESIGN section 7), after the real
// tiles. The mockup shows one wide slot and four small ones; Chores today
// took the wide one, Day at a glance and the Leaderboard two small ones, so
// two small ghosts remain.
const GHOST_SLOTS: readonly FeatureTile['size'][] = ['sm', 'sm'];

export function App() {
  useLiveUpdates();
  useTheme(zone);
  const { path, route } = useRoute();

  // The admin session sits above the router so an unlocked admin stays
  // unlocked across in-app navigation; a reload still drops it.
  return (
    <AdminSessionProvider>
      <div className="shell">
        <main className="shell-main">
          <View route={route} />
        </main>
        <BottomNav path={path} />
      </div>
    </AdminSessionProvider>
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
  // Wide tiles lead, as in the mockup: a wide tile after a small one would
  // leave a hole beside the small one wherever only two columns fit.
  const tiles = clientFeatureList
    .flatMap((feature) => (feature.tiles ?? []).map((tile, index) => ({ key: `${feature.id}-${String(index)}`, tile })))
    .sort((a, b) => Number(b.tile.size === 'wide') - Number(a.tile.size === 'wide'));

  return (
    <section className="home-grid" aria-label="Home">
      {tiles.map(({ key, tile: { component: Tile, size } }) => (
        <div key={key} className="tile" data-size={size}>
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

interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
}

/**
 * The bottom row: Home, each feature's page, then Admin. There is no header
 * clock; the kitchen has its own. Admin sits last, where a child is least
 * likely to tap it by accident, and says "Set a PIN" until one is set.
 */
function BottomNav({ path }: { path: string }) {
  const { pinStatus } = useAdminSession();
  const needsPin = pinStatus.kind === 'ready' && !pinStatus.pinSet;
  const items: NavItem[] = [
    { href: '/', label: 'Home', icon: House },
    ...clientFeatureList.map((feature) => ({
      href: `/${feature.id}`,
      label: feature.name,
      icon: feature.page?.icon ?? Circle,
    })),
    { href: '/admin', label: needsPin ? 'Set a PIN' : 'Admin', icon: Settings },
  ];
  const current = (href: string) =>
    href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`);

  return (
    <nav className="bottom-nav" aria-label="Main">
      {items.map(({ href, label, icon: Icon }) => (
        <a
          key={href}
          className="nav-item"
          href={href}
          onClick={followLink}
          aria-current={current(href) ? 'page' : undefined}
        >
          <Icon className="nav-icon" aria-hidden />
          {label}
        </a>
      ))}
    </nav>
  );
}
