/**
 * Feature-local state: the forge draft survives reloads so a half-written
 * prompt is never lost, and recent analyses are kept for one-click re-runs.
 * Lives beside the feature, not in the global store — only the forge page
 * cares about it.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { ForgeDraft } from './forge-schema';

export interface PromptHistoryEntry {
  id: string;
  prompt: string;
  status: 'COMPLETE' | 'INCOMPLETE';
  projectType: string | null;
  analyzedAt: string;
}

const HISTORY_LIMIT = 10;

interface ForgeState {
  draft: ForgeDraft | null;
  savedAt: string | null;
  history: PromptHistoryEntry[];
  saveDraft: (draft: ForgeDraft) => void;
  clearDraft: () => void;
  addHistory: (entry: Omit<PromptHistoryEntry, 'id' | 'analyzedAt'>) => void;
  clearHistory: () => void;
}

export const useForgeStore = create<ForgeState>()(
  persist(
    (set) => ({
      draft: null,
      savedAt: null,
      history: [],
      saveDraft: (draft) => {
        set({ draft, savedAt: new Date().toISOString() });
      },
      clearDraft: () => {
        set({ draft: null, savedAt: null });
      },
      addHistory: (entry) => {
        set((state) => {
          const next: PromptHistoryEntry = {
            ...entry,
            id: crypto.randomUUID(),
            analyzedAt: new Date().toISOString(),
          };
          // Re-analyzing the same prompt moves it to the top instead of
          // duplicating it.
          const others = state.history.filter((item) => item.prompt !== entry.prompt);
          return { history: [next, ...others].slice(0, HISTORY_LIMIT) };
        });
      },
      clearHistory: () => {
        set({ history: [] });
      },
    }),
    { name: 'nexarch.forge-draft' },
  ),
);
