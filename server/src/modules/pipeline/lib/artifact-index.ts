/**
 * Artifact addressing over the pipeline's existing run store.
 *
 * The pipeline already produces every artifact v2 names — they are the
 * fields of `PipelineArtifacts`. What was missing was the ability to ask
 * for *one* of them, or to ask what exists without paying for the content.
 *
 * This module adds exactly that and stores nothing new. It is a projection:
 * a `PipelineArtifacts` bundle in, descriptors and per-type slices out. The
 * run store stays the single home of generated output, which is why
 * `describeAll` derives size and summary from the live bundle instead of
 * recording them anywhere.
 *
 * Why it matters beyond tidiness: a v2 agent that needs the database design
 * must be able to fetch the database design. Today the only way to read one
 * field is to transfer the whole bundle — for the runs in this session,
 * ~3 MB to read a 40 KB object. That ratio is the token problem in HTTP
 * form, and this is where it stops.
 */
import type { ArtifactDescriptor, ArtifactType } from '../../../shared/contracts/artifact.js';
import type { PipelineArtifacts } from '../pipeline.types.js';

/** How each artifact type is extracted from a bundle, and how it describes itself. */
interface ArtifactSpec {
  type: ArtifactType;
  select: (bundle: PipelineArtifacts) => unknown;
  summarize: (bundle: PipelineArtifacts) => string;
  metadata: (bundle: PipelineArtifacts) => Record<string, unknown>;
}

const SPECS: readonly ArtifactSpec[] = [
  {
    type: 'requirement-spec',
    select: (b) => b.requirements,
    summarize: (b) =>
      `${b.requirements.projectType} · ${b.requirements.modules.length} modules · ${b.requirements.database.length} entities`,
    metadata: (b) => ({
      projectType: b.requirements.projectType,
      entities: b.requirements.database,
    }),
  },
  {
    type: 'architecture-plan',
    select: (b) => b.architecture,
    summarize: (b) =>
      `${b.architecture.apiModules.length} API modules · ${b.architecture.frontend.pages.length} pages`,
    metadata: (b) => ({ apiModules: b.architecture.apiModules.map((m) => m.module) }),
  },
  {
    type: 'architecture-markdown',
    select: (b) => b.architectureMarkdown,
    summarize: (b) => `${b.architectureMarkdown.split('\n').length} lines of Markdown`,
    metadata: () => ({ format: 'markdown' }),
  },
  {
    type: 'database-design',
    select: (b) => b.design.databaseDesign,
    summarize: (b) =>
      `${b.design.integrity.stats.tables} tables · ${b.design.integrity.stats.relationships} relationships`,
    metadata: (b) => ({ tables: b.design.databaseDesign.tables.map((t) => t.entity) }),
  },
  {
    type: 'api-contract',
    select: (b) => b.design.openapi,
    summarize: (b) => `${Object.keys(b.design.openapi.paths).length} paths`,
    metadata: (b) => ({ paths: Object.keys(b.design.openapi.paths).length }),
  },
  {
    type: 'backend-source',
    select: (b) => b.backend,
    summarize: (b) => `${b.backend.files.length} files · ${b.backend.routes.length} routes`,
    metadata: (b) => ({ files: b.backend.files.length, modules: b.backend.modules.length }),
  },
  {
    type: 'frontend-source',
    select: (b) => b.frontend,
    summarize: (b) => `${b.frontend.files.length} files · ${b.frontend.pages.length} pages`,
    metadata: (b) => ({ files: b.frontend.files.length, pages: b.frontend.pages.length }),
  },
  {
    type: 'security-report',
    select: (b) => b.security.report,
    summarize: (b) =>
      `grade ${b.security.report.grade} · ${b.security.report.findings.length} findings`,
    metadata: (b) => ({
      grade: b.security.report.grade,
      score: b.security.report.overallScore,
    }),
  },
  {
    type: 'dependency-graph',
    select: (b) => b.dependencies,
    summarize: (b) =>
      `${b.dependencies.stats.totalNodes} nodes · ${b.dependencies.stats.totalEdges} edges`,
    metadata: (b) => ({
      nodes: b.dependencies.stats.totalNodes,
      edges: b.dependencies.stats.totalEdges,
    }),
  },
  {
    type: 'project-files',
    select: (b) => b.files,
    summarize: (b) => `${b.files.length} runnable files`,
    metadata: (b) => ({ files: b.files.length }),
  },
];

export const ARTIFACT_TYPES: readonly ArtifactType[] = SPECS.map((spec) => spec.type);

export function isArtifactType(value: string): value is ArtifactType {
  return ARTIFACT_TYPES.includes(value as ArtifactType);
}

function sizeOf(value: unknown): number {
  if (typeof value === 'string') return Buffer.byteLength(value, 'utf8');
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

/**
 * Describes every artifact a completed run holds. Cheap relative to the
 * bundle — it serializes each field once to measure it, and returns
 * kilobytes where the bundle is megabytes.
 */
export function describeAll(
  bundle: PipelineArtifacts,
  projectId: string,
  createdAt: string,
): ArtifactDescriptor[] {
  return SPECS.map((spec) => ({
    id: `${bundle.runId}:${spec.type}`,
    projectId,
    runId: bundle.runId,
    type: spec.type,
    status: 'available' as const,
    summary: spec.summarize(bundle),
    metadata: spec.metadata(bundle),
    sizeBytes: sizeOf(spec.select(bundle)),
    createdAt,
    updatedAt: createdAt,
  }));
}

/** One artifact's content, or null when the type is unknown to this bundle. */
export function selectArtifact(bundle: PipelineArtifacts, type: ArtifactType): unknown {
  const spec = SPECS.find((candidate) => candidate.type === type);
  return spec ? spec.select(bundle) : null;
}
