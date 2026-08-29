/**
 * Keeps the Engineering Graph current as agents produce artifacts.
 *
 * The pipeline syncs the graph once, at the end, from a complete bundle.
 * The orchestrator cannot: a downstream agent's context request has to see
 * what upstream agents just produced, and "at the end" is far too late for
 * that. So the graph is re-synced after every completed task, from
 * whatever exists so far.
 *
 * This is cheap because sync is a diff, not a rebuild — a re-sync that
 * adds nothing writes nothing. And it is safe because it never fails a
 * run: a graph that could not be written is a thinner context for the next
 * agent, not a lost artifact.
 */
import { logger } from '../../../shared/logger/index.js';
import { synchronize } from '../../engineering-graph/index.js';
import type { PartialArtifacts } from '../../engineering-graph/lib/graph-builder.js';
import type { ArtifactType } from '../../../shared/contracts/index.js';
import type { AgentRun } from '../agent-orchestrator.types.js';
import type {
  DatabaseDesign,
  DesignBundle,
  OpenApiDocument,
} from '../../../shared/types/design.js';
import type { ArchitecturePlan } from '../../../shared/types/architecture.js';
import type { ProductSpec } from '../../../shared/types/product.js';
import type { RequirementSpec } from '../../../shared/types/requirement.js';
import type { PipelineArtifacts } from '../../pipeline/pipeline.types.js';

/** The file list inside a `*-config` artifact, when there is one. */
function filesOf(artifact: unknown): { path: string; content: string }[] {
  const value = artifact as { files?: { path: string; content: string }[] } | undefined;
  return value?.files ?? [];
}

/**
 * Reassembles the artifact map into the shape the graph builder reads.
 *
 * The two speak different vocabularies on purpose — agents emit named
 * artifact types, the builder consumes a pipeline bundle — and this is the
 * one place that translates, rather than every agent knowing the builder's
 * shape.
 */
function toBundle(artifacts: Partial<Record<ArtifactType, unknown>>): PartialArtifacts | null {
  const requirements = artifacts['requirement-spec'] as RequirementSpec | undefined;
  if (!requirements) return null;

  const design = artifacts['database-design'] as DatabaseDesign | undefined;
  const openapi = artifacts['api-contract'] as OpenApiDocument | undefined;
  const backend = artifacts['backend-metadata'];
  const frontend = artifacts['frontend-metadata'];

  const review = artifacts['engineering-review'] as { findings?: unknown[] } | undefined;

  const sourceFiles = [
    ...filesOf(artifacts['backend-config']),
    ...filesOf(artifacts['frontend-config']),
  ];

  return {
    requirements,
    ...(artifacts['product-spec'] ? { product: artifacts['product-spec'] as ProductSpec } : {}),
    ...(artifacts['architecture-plan']
      ? { architecture: artifacts['architecture-plan'] as ArchitecturePlan }
      : {}),
    // The builder reads `design.databaseDesign`; only those two fields of
    // the bundle are used, so a partial stand-in is honest rather than a
    // fake full object.
    ...(design ? { design: { databaseDesign: design, openapi } as unknown as DesignBundle } : {}),
    /*
     * The generation mesh's output. The builder already knows how to turn
     * backend modules into SERVICE/MODULE/FILE nodes and frontend pages
     * into COMPONENT/FILE nodes — that code was written for the pipeline
     * and needs no agent-specific variant. What it needs is the manifests,
     * which the engineers publish separately from their source precisely
     * so this translation does not have to carry a file tree.
     */
    ...(backend ? { backend: backend as unknown as PipelineArtifacts['backend'] } : {}),
    ...(frontend ? { frontend: frontend as unknown as PipelineArtifacts['frontend'] } : {}),
    // Package manifests are what the external-dependency section reads.
    ...(sourceFiles.length > 0 ? { files: sourceFiles } : {}),
    // The review's findings, so each becomes a FINDING node with a
    // TARGETS edge. The builder defines the slice it needs structurally;
    // `FindingRecord` satisfies it.
    ...(review?.findings
      ? { findings: review.findings as NonNullable<PartialArtifacts['findings']> }
      : {}),
  };
}

export interface GraphSyncSummary {
  nodes: number;
  edges: number;
  created: number;
}

/**
 * Project-level sync, for callers that have no AgentRun — the repair
 * engine, which operates on a project's latest artifacts after every run
 * has settled. Same translation, same diff-based write.
 */
export async function syncProjectArtifacts(
  projectId: string,
  runId: string,
  artifacts: Partial<Record<ArtifactType, unknown>>,
): Promise<GraphSyncSummary | null> {
  const bundle = toBundle(artifacts);
  if (!bundle) return null;
  try {
    const result = await synchronize(projectId, runId, bundle);
    return { nodes: result.nodeCount, edges: result.edgeCount, created: result.nodesCreated };
  } catch (error) {
    logger.warn('project graph sync failed', { projectId, error });
    return null;
  }
}

export async function syncPartialGraph(
  run: AgentRun,
  artifacts: Partial<Record<ArtifactType, unknown>>,
): Promise<GraphSyncSummary | null> {
  const bundle = toBundle(artifacts);
  if (!bundle) return null;

  try {
    const result = await synchronize(run.projectId, run.id, bundle);
    return { nodes: result.nodeCount, edges: result.edgeCount, created: result.nodesCreated };
  } catch (error) {
    logger.warn('partial graph sync failed', { runId: run.id, error });
    return null;
  }
}
