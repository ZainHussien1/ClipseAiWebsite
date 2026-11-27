import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { Suspense, lazy, type ComponentType } from 'react';
import { AppShell } from './components/shell/AppShell';
import { RouteErrorBoundary } from './components/ui/RouteErrorBoundary';
import { MissionControlPage } from './routes/MissionControlPage';

const SourcesPage = lazy(() =>
  import('./routes/SourcesPage').then((m) => ({ default: m.SourcesPage })),
);
const CreatorsPage = lazy(() =>
  import('./routes/CreatorsPage').then((m) => ({ default: m.CreatorsPage })),
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
const WorkBoardPage = lazy(() =>
  import('./routes/WorkBoardPage').then((m) => ({ default: m.WorkBoardPage })),
);
const MyWorkFilteredPage = lazy(() =>
  import('./routes/WorkBoardPage').then((m) => ({
    default: () => <m.WorkBoardPage mineOnly />,
  })),
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
    <RouteErrorBoundary routeName="Mission Control">
      <MissionControlPage />
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

const creatorsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/creators',
  component: () => <LazyRoute name="Creators" Component={CreatorsPage} />,
});

const creatorDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/creators/$accountId',
  component: function CreatorDetailRouteComponent() {
    const { accountId } = creatorDetailRoute.useParams();
    return (
      <RouteErrorBoundary routeName="Creator Detail">
        <Suspense
          fallback={
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 text-[12px] text-[var(--text-secondary)]">
              Loading Creator...
            </div>
          }
        >
          <CreatorsPage accountId={accountId} />
        </Suspense>
      </RouteErrorBoundary>
    );
  },
});

const sourcesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sources',
  component: () => <LazyRoute name="Sources" Component={SourcesPage} />,
});

const workRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/work',
  component: () => <LazyRoute name="Work Board" Component={WorkBoardPage} />,
});

const myWorkRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/my-work',
  component: () => <LazyRoute name="My Work" Component={MyWorkFilteredPage} />,
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
  creatorsRoute,
  creatorDetailRoute,
  sourcesRoute,
  workRoute,
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
