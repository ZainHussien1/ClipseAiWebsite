import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { Suspense, lazy, type ComponentType } from 'react';
import { AppShell } from './components/shell/AppShell';
import { RouteErrorBoundary } from './components/ui/RouteErrorBoundary';
import { OverviewPage } from './routes/OverviewPage';

const SourcesPage = lazy(() =>
  import('./routes/SourcesPage').then((m) => ({ default: m.SourcesPage })),
);
const FeedPage = lazy(() =>
  import('./routes/FeedPage').then((m) => ({ default: m.FeedPage })),
);
const LivePage = lazy(() =>
  import('./routes/LivePage').then((m) => ({ default: m.LivePage })),
);
const RisingPage = lazy(() =>
  import('./routes/RisingPage').then((m) => ({ default: m.RisingPage })),
);
const AlertsPage = lazy(() =>
  import('./routes/AlertsPage').then((m) => ({ default: m.AlertsPage })),
);
const MyWorkPage = lazy(() =>
  import('./routes/MyWorkPage').then((m) => ({ default: m.MyWorkPage })),
);
const NotificationsPage = lazy(() =>
  import('./routes/NotificationsPage').then((m) => ({ default: m.NotificationsPage })),
);
const ClipLogPage = lazy(() =>
  import('./routes/ClipLogPage').then((m) => ({ default: m.ClipLogPage })),
);
const ReportsPage = lazy(() =>
  import('./routes/ReportsPage').then((m) => ({ default: m.ReportsPage })),
);
const SettingsPage = lazy(() =>
  import('./routes/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);

function LazyRoute({
  name,
  Component,
}: {
  name: string;
  Component: ComponentType;
}) {
  return (
    <RouteErrorBoundary routeName={name}>
      <Suspense
        fallback={
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 text-[12px] text-[var(--text-secondary)]">
            Loading {name}...
          </div>
        }
      >
        <Component />
      </Suspense>
    </RouteErrorBoundary>
  );
}

const rootRoute = createRootRoute({ component: AppShell });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => (
    <RouteErrorBoundary routeName="Overview">
      <OverviewPage />
    </RouteErrorBoundary>
  ),
});

const feedRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/feed',
  component: () => <LazyRoute name="Feed" Component={FeedPage} />,
});

const liveRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/live',
  component: () => <LazyRoute name="Live Now" Component={LivePage} />,
});

const risingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/rising',
  component: () => <LazyRoute name="Rising" Component={RisingPage} />,
});

const alertsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/alerts',
  component: () => <LazyRoute name="Alerts" Component={AlertsPage} />,
});

const sourcesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sources',
  component: () => <LazyRoute name="Sources" Component={SourcesPage} />,
});

const myWorkRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/my-work',
  component: () => <LazyRoute name="My Work" Component={MyWorkPage} />,
});

const notificationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/notifications',
  component: () => <LazyRoute name="Notifications" Component={NotificationsPage} />,
});

const clipLogRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/clip-log',
  component: () => <LazyRoute name="Clip Log" Component={ClipLogPage} />,
});

const clipsAliasRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/clips',
  component: () => <LazyRoute name="Clip Log" Component={ClipLogPage} />,
});

const reportsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reports',
  component: () => <LazyRoute name="Reports" Component={ReportsPage} />,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: () => <LazyRoute name="Settings" Component={SettingsPage} />,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  feedRoute,
  liveRoute,
  risingRoute,
  alertsRoute,
  sourcesRoute,
  myWorkRoute,
  notificationsRoute,
  clipLogRoute,
  clipsAliasRoute,
  reportsRoute,
  settingsRoute,
]);

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
