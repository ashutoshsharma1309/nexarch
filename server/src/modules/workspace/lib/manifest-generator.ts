/**
 * Assembles `project-manifest.json` — a single machine-readable snapshot of
 * everything known about a project at export time (metadata, pipeline
 * artifact presence, stats). Distinct from the Dependency Graph's
 * per-version `ProjectManifest` (regeneration history); this one is the
 * whole-project export manifest the spec asks for.
 */
import type { Project, ProjectArtifacts } from '../workspace.types.js';

export function generateProjectManifest(
  artifacts: ProjectArtifacts,
  project?: Project,
): Record<string, unknown> {
  return {
    schemaVersion: '1.0',
    generatedAt: new Date().toISOString(),
    project: project
      ? {
          id: project.id,
          name: project.name,
          slug: project.slug,
          status: project.status,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
        }
      : { name: artifacts.projectName },
    pipeline: {
      requirementsAnalyzed: Boolean(artifacts.requirements),
      architecturePlanned: Boolean(artifacts.architecture),
      databaseDesigned: Boolean(artifacts.databaseDesign),
      backendGenerated: Boolean(artifacts.backend),
      frontendGenerated: Boolean(artifacts.frontend),
      securityReviewed: Boolean(artifacts.security),
      dependencyGraphBuilt: Boolean(artifacts.dependencyGraph),
    },
    stats: {
      backendFiles: artifacts.backend?.files.length ?? 0,
      frontendFiles: artifacts.frontend?.files.length ?? 0,
      apiEndpoints: artifacts.backend?.routes.length ?? 0,
      pages: artifacts.frontend?.pages.length ?? 0,
      dependencyGraphNodes: artifacts.dependencyGraph?.stats.totalNodes ?? 0,
      securityScore: artifacts.security?.report.overallScore ?? null,
    },
  };
}
