import { useQuery } from '@tanstack/react-query';

import { designDatabase } from '@/shared/services/design.service';
import { usePipelineStore } from '@/shared/store/pipeline.store';

/**
 * Design the database from the pipeline's current architecture plan. Keyed on
 * the plan's identity so the Database and API views share one cached bundle
 * and never re-request the same design.
 */
export function useDesignBundle() {
  const architecture = usePipelineStore((state) => state.architecture);
  const spec = usePipelineStore((state) => state.spec);

  return useQuery({
    queryKey: ['design', architecture?.meta.projectName, architecture?.meta.generatedAt],
    queryFn: () => {
      if (!architecture || !spec)
        throw new Error('Architecture plan and requirement spec are required');
      return designDatabase(architecture, spec);
    },
    enabled: Boolean(architecture && spec),
    staleTime: Infinity,
  });
}
