/**
 * Emits the Zustand stores every generated app ships with: theme (dark-first,
 * persisted, applies the `dark` class), auth (token + user, persisted),
 * toast (in-memory notification queue), and settings (workspace prefs,
 * persisted).
 */
import type { GeneratedFile } from '../frontend-generator.types.js';
import { file } from './file-tree.js';

const themeStore = `import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'dark' | 'light';

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      setTheme: (theme) => {
        applyTheme(theme);
        set({ theme });
      },
      toggleTheme: () => {
        get().setTheme(get().theme === 'dark' ? 'light' : 'dark');
      },
    }),
    {
      name: 'app.theme',
      onRehydrateStorage: () => (state) => {
        if (state) applyTheme(state.theme);
      },
    },
  ),
);
`;

const authStore = `import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  roles: string[];
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  isAuthenticated: boolean;
  login: (token: string, user: AuthUser) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      isAuthenticated: false,
      login: (token, user) => {
        set({ token, user, isAuthenticated: true });
      },
      logout: () => {
        set({ token: null, user: null, isAuthenticated: false });
      },
    }),
    { name: 'app.auth' },
  ),
);
`;

const toastStore = `import { create } from 'zustand';

export type ToastVariant = 'success' | 'error' | 'info';

export interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
}

interface ToastState {
  toasts: Toast[];
  push: (message: string, variant?: ToastVariant) => void;
  dismiss: (id: string) => void;
}

export const useToastStore = create<ToastState>()((set) => ({
  toasts: [],
  push: (message, variant = 'info') => {
    const toast: Toast = { id: crypto.randomUUID(), message, variant };
    set((state) => ({ toasts: [...state.toasts, toast] }));
  },
  dismiss: (id) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },
}));

/** Convenience accessor for use outside components (e.g. query error handlers). */
export function toast(message: string, variant: ToastVariant = 'info'): void {
  useToastStore.getState().push(message, variant);
}
`;

const settingsStore = `import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SettingsState {
  workspaceName: string;
  setWorkspaceName: (name: string) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      workspaceName: 'My workspace',
      setWorkspaceName: (name) => {
        set({ workspaceName: name });
      },
    }),
    { name: 'app.settings' },
  ),
);
`;

export function emitStores(): GeneratedFile[] {
  return [
    file('src/shared/store/theme.store.ts', 'typescript', themeStore),
    file('src/shared/store/auth.store.ts', 'typescript', authStore),
    file('src/shared/store/toast.store.ts', 'typescript', toastStore),
    file('src/shared/store/settings.store.ts', 'typescript', settingsStore),
  ];
}
