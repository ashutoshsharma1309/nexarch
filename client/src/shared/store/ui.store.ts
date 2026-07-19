/**
 * Global UI state: theme and the mobile navigation drawer.
 *
 * Theme is persisted and applied by toggling the `dark` class on <html>;
 * the inline script in index.html applies the persisted value before first
 * paint. State that belongs to one feature lives in that feature's store,
 * not here.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'dark' | 'light';

interface UiState {
  theme: Theme;
  mobileNavOpen: boolean;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  setMobileNavOpen: (open: boolean) => void;
}

function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      mobileNavOpen: false,
      setTheme: (theme) => {
        applyTheme(theme);
        set({ theme });
      },
      toggleTheme: () => {
        get().setTheme(get().theme === 'dark' ? 'light' : 'dark');
      },
      setMobileNavOpen: (open) => {
        set({ mobileNavOpen: open });
      },
    }),
    {
      name: 'nexarch.ui',
      partialize: (state) => ({ theme: state.theme }),
      onRehydrateStorage: () => (state) => {
        if (state) applyTheme(state.theme);
      },
    },
  ),
);
