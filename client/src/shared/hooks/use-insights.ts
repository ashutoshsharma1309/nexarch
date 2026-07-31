/**
 * Insights load automatically: the query turns itself on the moment the
 * pipeline has produced the three artifacts the analysis needs — the
 * same enabled-on-upstream chaining every Explorer page uses — so by the
 * time the user opens the Insights page the analysis is already there.
 */
import { useQuery } from '@tanstack/react-query';

import { useDesignBundle } from '@/features/database/use-design';
import { generateInsights } from '@/shared/services/insights.service';
import { usePipelineStore } from '@/shared/store/pipeline.store';

export function useInsights() {
  const spec = usePipelineStore((state) => state.spec);
  const architecture = usePipelineStore((state) => state.architecture);
  const design = useDesignBundle();

  const databaseDesign = design.data?.databaseDesign;

  return useQuery({
    queryKey: ['insights', architecture?.meta.projectName, architecture?.meta.generatedAt],
    enabled: Boolean(spec && architecture && databaseDesign),
    queryFn: () => {
      if (!spec || !architecture || !databaseDesign) {
        throw new Error('Insights need requirements, architecture and database design');
      }
      return generateInsights({
        projectName: architecture.meta.projectName,
        requirements: spec,
        architecture,
        databaseDesign,
      });
    },
    staleTime: Infinity, // same artifacts → same analysis; regenerate only with the pipeline
  });
}
