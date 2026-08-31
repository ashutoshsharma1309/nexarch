import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';

import { LoadingScreen } from '@/shared/components/loading-screen';
import { useAuthStore } from '@/shared/store/auth.store';

/**
 * The shell gate.
 *
 * Login has been removed: the server auto-authenticates every request as a
 * single built-in local user, so `hydrate()` always resolves to that user.
 * This still runs it once on cold load — the loading screen covers that one
 * round-trip so the app has its user before it renders — but there is no
 * login page to bounce to, so an unresolved session simply falls through to
 * the app rather than redirecting.
 */
export function RequireAuth() {
  const status = useAuthStore((state) => state.status);
  const hydrate = useAuthStore((state) => state.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  if (status === 'unknown') return <LoadingScreen />;

  return <Outlet />;
}
