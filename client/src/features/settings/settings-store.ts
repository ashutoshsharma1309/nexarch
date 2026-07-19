/**
 * Workspace preferences, persisted locally until accounts exist (Phase 3
 * moves this server-side behind the auth module).
 */
import { create } from 'zustand';
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
    { name: 'nexarch.settings' },
  ),
);
