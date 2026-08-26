/**
 * Session state.
 *
 * Deliberately *not* persisted: the server's httpOnly cookie is the single
 * source of truth for whether a session exists, and `hydrate()` asks it on
 * boot. Mirroring the user into localStorage would only create a second,
 * staler answer to the same question — and a signed-out user who still
 * looks signed in until their first 401.
 */
import { create } from 'zustand';

import { fetchSession } from '@/shared/services/auth.service';
import type { AuthUser } from '@/shared/types/api';

export type AuthStatus = 'unknown' | 'authenticated' | 'anonymous';

interface AuthState {
  user: AuthUser | null;
  status: AuthStatus;
  setUser: (user: AuthUser) => void;
  clear: () => void;
  hydrate: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  user: null,
  status: 'unknown',
  setUser: (user) => {
    set({ user, status: 'authenticated' });
  },
  clear: () => {
    set({ user: null, status: 'anonymous' });
  },
  hydrate: async () => {
    // Re-entrancy guard: the router and the shell can both ask on first paint.
    if (get().status !== 'unknown') return;
    const user = await fetchSession();
    set(user ? { user, status: 'authenticated' } : { user: null, status: 'anonymous' });
  },
}));
