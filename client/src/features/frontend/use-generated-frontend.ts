import { useQuery } from '@tanstack/react-query';

import { useDesignBundle } from '@/features/database/use-design';
import { useGeneratedBackend } from '@/features/backend/use-generated-backend';
import { generateFrontend } from '@/shared/services/frontend-generator.service';
import { usePipelineStore } from '@/shared/store/pipeline.store';
import type { BackendManifest } from '@/shared/types/api';

/**
 * Generate the frontend from the pipeline's design bundle and backend
 * manifest. Chains off the Database and Backend views' own queries (same
 * architecture-plan identity as their cache keys) so opening the Frontend
 * Explorer first still works — it just triggers the design and backend
 * fetches in sequence.
 */
export function useGeneratedFrontend() {
  const architecture = usePipelineStore((state) => state.architecture);
  const spec = usePipelineStore((state) => state.spec);
  const design = useDesignBundle();
  const backend = useGeneratedBackend();

  const query = useQuery({
    queryKey: ['frontend', architecture?.meta.projectName, architecture?.meta.generatedAt],
    queryFn: () => {
      if (!architecture || !spec || !design.data || !backend.data) {
        throw new Error(
          'Architecture plan, requirement spec, database design and backend manifest are required',
        );
      }
      const backendManifest: BackendManifest = {
        modules: backend.data.modules,
        routes: backend.data.routes,
      };
      return generateFrontend(architecture, spec, design.data, backendManifest);
    },
    enabled: Boolean(architecture && spec && design.data && backend.data),
    staleTime: Infinity,
  });

  return {
    ...query,
    isPending: query.isPending && Boolean(architecture),
    upstreamPending: design.isPending || backend.isPending,
  };
}
