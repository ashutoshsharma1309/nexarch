/**
 * Pipeline artifacts shared across features. The COMPLETE RequirementSpec
 * flows from the Forge (analyzer) into the Architecture view (planner), and
 * the resulting ArchitecturePlan flows on into the Database view (designer).
 * Persisted so a reload doesn't lose the working pipeline; a new analysis
 * clears the downstream plan so stages never show stale downstream output.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { ArchitecturePlan, RequirementSpec } from '@/shared/types/api';

interface PipelineState {
  spec: RequirementSpec | null;
  specUpdatedAt: string | null;
  architecture: ArchitecturePlan | null;
  setSpec: (spec: RequirementSpec) => void;
  setArchitecture: (architecture: ArchitecturePlan) => void;
  clearSpec: () => void;
}

export const usePipelineStore = create<PipelineState>()(
  persist(
    (set) => ({
      spec: null,
      specUpdatedAt: null,
      architecture: null,
      setSpec: (spec) => {
        // A fresh analysis invalidates any downstream plan.
        set({ spec, specUpdatedAt: new Date().toISOString(), architecture: null });
      },
      setArchitecture: (architecture) => {
        set({ architecture });
      },
      clearSpec: () => {
        set({ spec: null, specUpdatedAt: null, architecture: null });
      },
    }),
    { name: 'nexarch.pipeline' },
  ),
);
