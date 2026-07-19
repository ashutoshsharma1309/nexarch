/**
 * Pipeline artifacts shared across features: the latest COMPLETE
 * RequirementSpec flows from the Forge (analyzer) into the Architecture
 * view (planner). Persisted so a reload doesn't lose the working spec.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { RequirementSpec } from '@/shared/types/api';

interface PipelineState {
  spec: RequirementSpec | null;
  specUpdatedAt: string | null;
  setSpec: (spec: RequirementSpec) => void;
  clearSpec: () => void;
}

export const usePipelineStore = create<PipelineState>()(
  persist(
    (set) => ({
      spec: null,
      specUpdatedAt: null,
      setSpec: (spec) => {
        set({ spec, specUpdatedAt: new Date().toISOString() });
      },
      clearSpec: () => {
        set({ spec: null, specUpdatedAt: null });
      },
    }),
    { name: 'nexarch.pipeline' },
  ),
);
