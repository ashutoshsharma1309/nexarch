import { useGeneratedBackend } from '@/features/backend/use-generated-backend';
import { useDesignBundle } from '@/features/database/use-design';
import { useDependencyGraph } from '@/features/dependency-graph/use-dependency-graph';
import { useGeneratedFrontend } from '@/features/frontend/use-generated-frontend';
import { useSecurityBundle } from '@/features/security/use-security-bundle';
import { usePipelineStore } from '@/shared/store/pipeline.store';
import type { ProjectArtifacts } from '@/shared/types/api';

/**
 * Assembles a `ProjectArtifacts` bag for Documentation/Export from whatever
 * pipeline stage the workspace has currently reached. Chains the same
 * per-stage hooks every Explorer page already uses (design → backend →
 * frontend → security → dependency graph) — each `enabled` on its
 * upstream's presence, so this is safe to mount from any page: it re-uses
 * cached results where they exist and triggers the same fetch chain the
 * Explorer pages would, never duplicating requests React Query already has
 * in flight or cached.
 */
export function useCurrentArtifacts(): { artifacts: ProjectArtifacts | null; isPending: boolean } {
  const spec = usePipelineStore((state) => state.spec);
  const architecture = usePipelineStore((state) => state.architecture);
  const design = useDesignBundle();
  const backend = useGeneratedBackend();
  const frontend = useGeneratedFrontend();
  const security = useSecurityBundle();
  const dependencyGraph = useDependencyGraph();

  if (!spec && !architecture) {
    return { artifacts: null, isPending: false };
  }

  const artifacts: ProjectArtifacts = {
    projectName: architecture?.meta.projectName ?? spec?.projectName ?? 'Untitled Project',
    requirements: spec ?? undefined,
    architecture: architecture ?? undefined,
    databaseDesign: design.data?.databaseDesign,
    prismaSchema: design.data?.prismaSchema,
    sqlSchema: design.data?.sqlSchema,
    openapi: design.data?.openapi,
    backend: backend.data
      ? {
          files: backend.data.files.map((f) => ({ path: f.path, content: f.content })),
          modules: backend.data.modules.map((m) => m.name),
          routes: backend.data.routes,
        }
      : undefined,
    frontend: frontend.data
      ? {
          files: frontend.data.files.map((f) => ({ path: f.path, content: f.content })),
          pages: frontend.data.pages.map((p) => ({ name: p.name, route: p.route })),
          components: frontend.data.components.map((c) => c.name),
        }
      : undefined,
    security: security.data
      ? { report: security.data.report, owasp: security.data.owasp, stats: security.data.stats }
      : undefined,
    dependencyGraph: dependencyGraph.data
      ? {
          stats: dependencyGraph.data.stats,
          quality: { recommendations: dependencyGraph.data.quality.recommendations },
        }
      : undefined,
  };

  const isPending =
    Boolean(architecture) &&
    (design.isPending || backend.isPending || frontend.isPending || security.isPending);

  return { artifacts, isPending };
}
