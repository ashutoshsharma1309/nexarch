import { useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { LoadingScreen } from '@/shared/components/loading-screen';
import { useAuthStore } from '@/shared/store/auth.store';

/**
 * The route guard for everything behind the console shell.
 *
 * On a cold load the session state is `unknown` — the cookie may or may not
 * be valid, and only the server can say. Rendering the loading screen for
 * that one round-trip is what prevents the flash of a login page that a
 * signed-in user should never have seen.
 */
export function RequireAuth() {
  const status = useAuthStore((state) => state.status);
  const hydrate = useAuthStore((state) => state.hydrate);
  const location = useLocation();

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  if (status === 'unknown') return <LoadingScreen />;

  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }

  return <Outlet />;
}

/**
 * The mirror image: keeps a signed-in user out of the login and register
 * pages.
 *
 * This guard — not the forms — decides where a newly authenticated user
 * lands. It has to: the moment a form sets the session, this component
 * re-renders and its `<Navigate>` runs, which would win any race against a
 * `navigate()` call inside the form's own success handler. Putting the
 * decision here makes it a single, predictable rule instead of a race.
 */
export function RedirectIfAuthenticated() {
  const status = useAuthStore((state) => state.status);
  const hydrate = useAuthStore((state) => state.hydrate);
  const location = useLocation();

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  if (status === 'unknown') return <LoadingScreen />;

  if (status === 'authenticated') {
    // Whatever RequireAuth bounced them from wins; otherwise a brand-new
    // account starts at the Forge (there is nothing on the dashboard yet)
    // and a returning sign-in starts at the dashboard.
    const from = (location.state as { from?: string } | null)?.from;
    const fallback = location.pathname === '/register' ? '/forge' : '/';
    return <Navigate to={from ?? fallback} replace />;
  }

  return <Outlet />;
}
