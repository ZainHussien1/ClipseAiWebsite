import {
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { Suspense, lazy } from 'react';
import { AppShell } from './components/shell/AppShell';
import type { NavItem } from './components/shell/nav';
import { RouteErrorBoundary } from './components/ui/RouteErrorBoundary';
import { OverviewPage } from './routes/OverviewPage';

const PendingModulePage = lazy(() =>
  import('./routes/PendingModulePage').then((mod) => ({
    default: mod.PendingModulePage,
  })),
);

function PendingWrapper({ path, name }: { path: NavItem['to']; name: string }) {
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

const rootRoute = createRootRoute({
  component: AppShell,
});

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
  component: () => <PendingWrapper path="/feed" name="Feed" />,
});

const liveRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/live',
  component: () => <PendingWrapper path="/live" name="Live Now" />,
});

const risingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/rising',
  component: () => <PendingWrapper path="/rising" name="Rising" />,
});

const sourcesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sources',
  component: () => <PendingWrapper path="/sources" name="Sources" />,
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
