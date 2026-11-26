import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Outlet } from '@tanstack/react-router';
import { useCallback, useEffect, useState } from 'react';
import { fetchAuthStatus, fetchHealth, logoutSession, type SystemStatus } from '../../lib/api';
import { listNotifications } from '../../lib/api-v1';
import { useOnlineStatus } from '../../lib/useOnlineStatus';
import { CommandPalette } from './CommandPalette';
import { MobileNav } from './MobileNav';
import { OfflineBanner } from './OfflineBanner';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { WorkspaceAuthCard } from './WorkspaceAuthCard';

export function AppShell() {
  const queryClient = useQueryClient();
  const isOnline = useOnlineStatus();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const healthQuery = useQuery({
    queryKey: ['system', 'health'],
    queryFn: fetchHealth,
    refetchInterval: 30_000,
    retry: 1,
  });

  const authQuery = useQuery({
    queryKey: ['auth', 'status'],
    queryFn: fetchAuthStatus,
    retry: 1,
  });

  const authReady = Boolean(authQuery.data?.authenticated);
  const needsSessionSignIn =
    authQuery.data?.mode === 'session' && !authQuery.data.authenticated;

  const notifQuery = useQuery({
    queryKey: ['notifications'],
    queryFn: listNotifications,
    enabled: authReady,
    refetchInterval: 60_000,
    retry: false,
  });

  const unreadCount = (notifQuery.data?.notifications ?? []).filter((n) => !n.readAt).length;

  const effectiveStatus: SystemStatus = !isOnline
    ? 'offline'
    : (healthQuery.data?.status ?? 'degraded');

  const refreshHealth = useCallback(() => {
    void healthQuery.refetch();
  }, [healthQuery]);

  const handleSignOut = useCallback(() => {
    void logoutSession().then(() => {
      void queryClient.invalidateQueries({ queryKey: ['auth', 'status'] });
      void queryClient.invalidateQueries({ queryKey: ['system', 'me'] });
      queryClient.removeQueries({ queryKey: ['notifications'] });
    });
  }, [queryClient]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="flex min-h-dvh bg-[var(--bg)] text-[var(--text-primary)]">
      <Sidebar health={healthQuery.data} />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          status={effectiveStatus}
          health={healthQuery.data}
          unreadCount={unreadCount}
          showSignOut={authQuery.data?.mode === 'session' && authReady}
          isFetchingHealth={healthQuery.isFetching}
          onRefreshHealth={refreshHealth}
          onSignOut={handleSignOut}
          onOpenCommandPalette={() => setPaletteOpen(true)}
          onOpenMobileDrawer={() => setDrawerOpen(true)}
        />

        <OfflineBanner
          visible={effectiveStatus === 'offline'}
          detail={!isOnline ? 'Browser is offline' : (healthQuery.data?.detail ?? null)}
          onRetry={refreshHealth}
        />

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-20 pt-5 sm:px-6 md:pb-8">
          {authQuery.isLoading ? (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 text-[12px] text-[var(--text-secondary)]">
              Checking workspace session...
            </div>
          ) : needsSessionSignIn ? (
            <WorkspaceAuthCard hasWorkspace={Boolean(authQuery.data?.hasWorkspace)} />
          ) : (
            <Outlet />
          )}
        </main>
      </div>

      <MobileNav
        drawerOpen={drawerOpen}
        onOpenDrawer={() => setDrawerOpen(true)}
        onCloseDrawer={() => setDrawerOpen(false)}
      />

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onRefreshHealth={refreshHealth}
      />
    </div>
  );
}
