import { useMutation, useQuery } from '@tanstack/react-query';

import { useGeneratedBackend } from '@/features/backend/use-generated-backend';
import { useDesignBundle } from '@/features/database/use-design';
import { useGeneratedFrontend } from '@/features/frontend/use-generated-frontend';
import { useSecurityBundle } from '@/features/security/use-security-bundle';
import {
  analyzeChangeImpact,
  buildDependencyGraph,
} from '@/shared/services/dependency-graph.service';
import { usePipelineStore } from '@/shared/store/pipeline.store';

/**
 * Builds the dependency graph from the pipeline's design bundle, backend,
 * frontend, and security output. Chains off all four views' own queries so
 * opening the Dependency Graph dashboard first still works — it just
 * triggers the earlier stages in sequence.
 */
export function useDependencyGraph() {
  const architecture = usePipelineStore((state) => state.architecture);
  const spec = usePipelineStore((state) => state.spec);
  const design = useDesignBundle();
  const backend = useGeneratedBackend();
  const frontend = useGeneratedFrontend();
  const security = useSecurityBundle();

  const ready = Boolean(
    architecture && spec && design.data && backend.data && frontend.data && security.data,
  );

  const query = useQuery({
    queryKey: ['dependency-graph', architecture?.meta.projectName, architecture?.meta.generatedAt],
    queryFn: () => {
      if (
        !architecture ||
        !spec ||
        !design.data ||
        !backend.data ||
        !frontend.data ||
        !security.data
      ) {
        throw new Error('The full pipeline (architecture through security) is required');
      }
      return buildDependencyGraph(
        spec,
        architecture,
        design.data,
        backend.data,
        frontend.data,
        security.data,
      );
    },
    enabled: ready,
    staleTime: Infinity,
  });

  return {
    ...query,
    isPending: query.isPending && Boolean(architecture),
    upstreamPending:
      design.isPending || backend.isPending || frontend.isPending || security.isPending,
  };
}

/** On-demand impact analysis for a natural-language change request — not auto-run, triggered by the user. */
export function useImpactAnalysis() {
  const architecture = usePipelineStore((state) => state.architecture);
  const spec = usePipelineStore((state) => state.spec);
  const design = useDesignBundle();
  const backend = useGeneratedBackend();
  const frontend = useGeneratedFrontend();
  const security = useSecurityBundle();

  return useMutation({
    mutationFn: (changeRequest: string) => {
      if (
        !architecture ||
        !spec ||
        !design.data ||
        !backend.data ||
        !frontend.data ||
        !security.data
      ) {
        throw new Error('The full pipeline (architecture through security) is required');
      }
      return analyzeChangeImpact(
        changeRequest,
        spec,
        architecture,
        design.data,
        backend.data,
        frontend.data,
        security.data,
      );
    },
  });
}
