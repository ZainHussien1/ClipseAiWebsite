import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { Suspense, lazy, type ComponentType } from 'react';
import { AppShell } from './components/shell/AppShell';
import type { AppRoutePath } from './components/shell/nav';
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
const MyWorkPage = lazy(() =>
  import('./routes/MyWorkPage').then((m) => ({ default: m.MyWorkPage })),
);
const PendingModulePage = lazy(() =>
  import('./routes/PendingModulePage').then((m) => ({ default: m.PendingModulePage })),
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

function PendingWrapper({ path, name }: { path: AppRoutePath; name: string }) {
  return (
    <RouteErrorBoundary routeName={name}>
      <Suspense
        fallback={
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 text-[12px] text-[var(--text-secondary)]">
            Loading {name}...
          </div>
        }
      >
        <PendingModulePage path={path} />
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

const clipsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/clips',
  component: () => <PendingWrapper path="/clips" name="Clip Log" />,
});

const reportsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reports',
  component: () => <PendingWrapper path="/reports" name="Reports" />,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: () => <PendingWrapper path="/settings" name="Settings" />,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  feedRoute,
  liveRoute,
  risingRoute,
  sourcesRoute,
  myWorkRoute,
  clipsRoute,
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
