import { useQuery } from '@tanstack/react-query';

import { useDesignBundle } from '@/features/database/use-design';
import { useGeneratedBackend } from '@/features/backend/use-generated-backend';
import { useGeneratedFrontend } from '@/features/frontend/use-generated-frontend';
import { applySecurity } from '@/shared/services/security-engine.service';
import { usePipelineStore } from '@/shared/store/pipeline.store';
import type { BackendManifest, FrontendManifest } from '@/shared/types/api';

/**
 * Runs the Security Engine's `apply()` from the pipeline's design bundle,
 * backend manifest, and frontend manifest. Chains off the Database,
 * Backend, and Frontend views' own queries so opening the Security
 * Dashboard first still works — it just triggers the earlier stages in
 * sequence.
 */
export function useSecurityBundle() {
  const architecture = usePipelineStore((state) => state.architecture);
  const spec = usePipelineStore((state) => state.spec);
  const design = useDesignBundle();
  const backend = useGeneratedBackend();
  const frontend = useGeneratedFrontend();

  const query = useQuery({
    queryKey: ['security', architecture?.meta.projectName, architecture?.meta.generatedAt],
    queryFn: () => {
      if (!architecture || !spec || !design.data || !backend.data || !frontend.data) {
        throw new Error(
          'Architecture plan, requirement spec, database design, backend manifest and frontend manifest are required',
        );
      }
      const backendManifest: BackendManifest = {
        modules: backend.data.modules,
        routes: backend.data.routes,
      };
      const frontendManifest: FrontendManifest = {
        pages: frontend.data.pages.map((p) => ({
          name: p.name,
          route: p.route,
          kind: p.kind,
          entity: p.entity,
          implemented: p.implemented,
        })),
      };
      return applySecurity(architecture, spec, design.data, backendManifest, frontendManifest);
    },
    enabled: Boolean(architecture && spec && design.data && backend.data && frontend.data),
    staleTime: Infinity,
  });

  return {
    ...query,
    isPending: query.isPending && Boolean(architecture),
    upstreamPending: design.isPending || backend.isPending || frontend.isPending,
  };
}
