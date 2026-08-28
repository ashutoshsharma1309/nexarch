/**
 * The single built-in user for no-auth mode.
 *
 * When AUTH_DISABLED is on (the default), there is no login and no user
 * table — every request runs as this one local identity, and everything a
 * user would own is owned by it. Onboarding state is kept here in memory so
 * the first-run welcome can still be completed within a session; it resets
 * with the process, like the rest of no-auth mode's state.
 */
import type { AuthUser } from '../auth.types.js';

/** Stable id so ownership scoping has a consistent owner across the process. */
export const LOCAL_USER_ID = 'local-user';

let onboardedAt: string | null = null;

export function getLocalUser(): AuthUser {
  return {
    id: LOCAL_USER_ID,
    email: 'local@nexarch.dev',
    name: 'Local User',
    role: 'ADMIN',
    createdAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
    onboardedAt,
  };
}

/** Marks onboarding complete for the local user (in-memory, session-scoped). */
export function completeLocalOnboarding(): AuthUser {
  onboardedAt = new Date().toISOString();
  return getLocalUser();
}
