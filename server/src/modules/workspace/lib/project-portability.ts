/**
 * Export and import wiring: the live stores ↔ a portable package.
 *
 * This is the one place that reaches across into the orchestrator's stores
 * to read a project's whole state for export, and to seed a fresh
 * project's state on import. It lives in `workspace` because a package is a
 * project-management concern; it depends inward on the stores rather than
 * the other way around, so the agent runtime never learns about packaging.
 *
 * Import always creates a *new* project owned by the importing user with a
 * *new* id, and re-keys everything to it. Nothing from the package's origin
 * — its ids, its ownership, its session tokens — survives; a package is
 * data describing a project, not a claim to be one.
 */
import { loadNodes, loadEdges } from '../../engineering-graph/lib/graph-repository.js';
import { syncProjectArtifacts } from '../../agent-orchestrator/lib/graph-sync.js';
import { latestArtifacts, writeArtifact } from '../../agent-orchestrator/lib/artifact-store.js';
import {
  beginReview,
  listFindings,
  recordFinding,
} from '../../agent-orchestrator/lib/finding-store.js';
import { listRepairs } from '../../agent-orchestrator/lib/repair-store.js';
import { buildPackage, validatePackage } from './project-package.js';
import type { ProjectPackage } from './project-package.js';
import type { ArtifactType, AgentFinding, FindingType } from '../../../shared/contracts/index.js';

/** Reads a project's whole state into a portable package. */
export async function exportProjectPackage(
  projectId: string,
  name: string,
  description: string | null,
  kind: 'project' | 'demo' = 'project',
): Promise<ProjectPackage> {
  const artifacts = latestArtifacts(projectId).map((record) => ({
    type: record.type,
    version: record.version,
    summary: null as string | null,
    content: record.content,
  }));
  const [nodes, edges] = await Promise.all([loadNodes(projectId), loadEdges(projectId)]);

  return buildPackage({
    name,
    description,
    kind,
    artifacts,
    graphNodes: nodes.map((node) => ({
      id: node.id,
      type: node.type,
      canonicalName: node.canonicalName,
      name: node.name,
      metadata: node.metadata,
    })),
    graphEdges: edges.map((edge) => ({
      sourceNodeId: edge.sourceNodeId,
      relationship: edge.relationship,
      targetNodeId: edge.targetNodeId,
    })),
    // Only the descriptive content of a finding is portable. Its id, run,
    // review counters and timestamps are this project's bookkeeping — they
    // mean nothing in another project, and carrying them would make two
    // exports of the same state differ over nothing.
    findings: listFindings(projectId).map((finding) => ({
      type: finding.type,
      severity: finding.severity,
      category: finding.category,
      title: finding.title,
      description: finding.description,
      evidence: finding.evidence,
      targetFile: finding.targetFile,
      recommendation: finding.recommendation,
      confidence: finding.confidence,
      status: finding.status,
    })),
    validation:
      latestArtifacts(projectId).find((record) => record.type === 'validation-summary')?.content ??
      null,
    repairs: listRepairs(projectId).map((repair) => ({
      findingTitle: repair.findingTitle,
      severity: repair.severity,
      result: repair.result,
      rolledBack: repair.rolledBack,
    })),
  });
}

export interface ImportResult {
  package: ProjectPackage;
  artifactsSeeded: number;
  findingsSeeded: number;
  graphSynced: boolean;
}

/**
 * Seeds a newly-created project from a validated package.
 *
 * The package is validated first (schema, paths, size — see
 * `validatePackage`); only then is anything written, and everything is
 * written under the *new* project id. The graph is rebuilt from the
 * imported artifacts rather than trusting the package's node ids, so an
 * imported project's graph is internally consistent by construction.
 */
export async function importIntoProject(
  newProjectId: string,
  rawPackage: unknown,
): Promise<ImportResult> {
  const pkg = validatePackage(rawPackage);

  /* Artifacts — re-versioned under the new project. */
  for (const artifact of pkg.artifacts) {
    writeArtifact({
      projectId: newProjectId,
      runId: 'import',
      type: artifact.type as ArtifactType,
      agentId: 'requirement-analyst',
      agentVersion: 'import',
      derivedFrom: [],
      content: artifact.content,
    });
  }

  /*
   * Graph — rebuilt from the imported artifacts by the same
   * project-level sync the orchestrator uses, not trusting the package's
   * node ids. A graph that will not rebuild is not fatal: the artifacts
   * are the substance, the graph is derived from them.
   */
  const artifactMap: Partial<Record<ArtifactType, unknown>> = {};
  for (const record of latestArtifacts(newProjectId)) artifactMap[record.type] = record.content;
  const synced = await syncProjectArtifacts(newProjectId, 'import', artifactMap);
  const graphSynced = synced !== null;

  /* Findings — recorded fresh under the new project's own review. */
  let findingsSeeded = 0;
  if (pkg.findings.length > 0) {
    const version = beginReview(newProjectId);
    for (const raw of pkg.findings) {
      const finding = raw as Partial<AgentFinding> & { type?: FindingType; category?: string };
      if (typeof finding.title !== 'string' || typeof finding.category !== 'string') continue;
      recordFinding({
        projectId: newProjectId,
        runId: 'import',
        agentId: 'security-engineer',
        reviewVersion: version,
        finding: {
          type: finding.type ?? 'GENERAL',
          severity: finding.severity ?? 'LOW',
          category: finding.category,
          title: finding.title,
          description: typeof finding.description === 'string' ? finding.description : '',
          targetNodeId: null,
          targetFile: typeof finding.targetFile === 'string' ? finding.targetFile : null,
          evidence: typeof finding.evidence === 'string' ? finding.evidence : null,
          recommendation:
            typeof finding.recommendation === 'string' ? finding.recommendation : null,
          confidence: typeof finding.confidence === 'number' ? finding.confidence : 1,
          status: 'OPEN',
        },
      });
      findingsSeeded += 1;
    }
  }

  return {
    package: pkg,
    artifactsSeeded: pkg.artifacts.length,
    findingsSeeded,
    graphSynced,
  };
}
