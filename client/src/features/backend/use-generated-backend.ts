import { useQuery } from '@tanstack/react-query';

import { useDesignBundle } from '@/features/database/use-design';
import { generateBackend } from '@/shared/services/backend-generator.service';
import { usePipelineStore } from '@/shared/store/pipeline.store';

/**
 * Generate the backend from the pipeline's current design bundle. Chains
 * off the Database view's own query (same architecture-plan identity as its
 * cache key) so opening the Backend Explorer first still works — it just
 * triggers the design fetch and then the generation in sequence.
 */
export function useGeneratedBackend() {
  const architecture = usePipelineStore((state) => state.architecture);
  const spec = usePipelineStore((state) => state.spec);
  const design = useDesignBundle();

  const query = useQuery({
    queryKey: ['backend', architecture?.meta.projectName, architecture?.meta.generatedAt],
    queryFn: () => {
      if (!architecture || !spec || !design.data) {
        throw new Error('Architecture plan, requirement spec and database design are required');
      }
      return generateBackend(architecture, spec, design.data);
    },
    enabled: Boolean(architecture && spec && design.data),
    staleTime: Infinity,
  });

  return {
    ...query,
    isPending: query.isPending && Boolean(architecture),
    designPending: design.isPending,
  };
}
