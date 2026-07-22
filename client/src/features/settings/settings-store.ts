/**
 * Workspace preferences, persisted locally until accounts exist (Phase 3
 * moves this server-side behind the auth module).
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { AiProviderId, ExportFormat } from '@/shared/types/api';

interface SettingsState {
  workspaceName: string;
  preferredProvider: AiProviderId;
  preferredModel: string;
  maxTokensPerRequest: number;
  defaultExportFormat: ExportFormat;
  favoriteNewProjects: boolean;
  setWorkspaceName: (name: string) => void;
  setPreferredProvider: (provider: AiProviderId) => void;
  setPreferredModel: (model: string) => void;
  setMaxTokensPerRequest: (tokens: number) => void;
  setDefaultExportFormat: (format: ExportFormat) => void;
  setFavoriteNewProjects: (favorite: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      workspaceName: 'My workspace',
      preferredProvider: 'mock',
      preferredModel: 'mock-fast',
      maxTokensPerRequest: 8000,
      defaultExportFormat: 'zip-project',
      favoriteNewProjects: false,
      setWorkspaceName: (name) => {
        set({ workspaceName: name });
      },
      setPreferredProvider: (provider) => {
        set({ preferredProvider: provider });
      },
      setPreferredModel: (model) => {
        set({ preferredModel: model });
      },
      setMaxTokensPerRequest: (tokens) => {
        set({ maxTokensPerRequest: tokens });
      },
      setDefaultExportFormat: (format) => {
        set({ defaultExportFormat: format });
      },
      setFavoriteNewProjects: (favorite) => {
        set({ favoriteNewProjects: favorite });
      },
    }),
    { name: 'nexarch.settings' },
  ),
);
