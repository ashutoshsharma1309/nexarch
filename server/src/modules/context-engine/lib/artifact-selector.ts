/**
 * Which artifacts a task's selected nodes actually need.
 *
 * Node types imply artifacts: an ENTITY needs the database design, an API
 * needs the contract, a SERVICE needs the architecture plan. Rather than
 * loading the whole bundle and letting the compiler pick, the need is
 * derived first and only those artifacts are resolved — the difference
 * between reading one 9 KB object and materializing a megabyte.
 */
import type { ArtifactType, GraphNodeType } from '../../../shared/contracts/index.js';
import type { ScoredNode, TaskType } from '../context-engine.types.js';

/** The artifact a node of each type is described by. */
const ARTIFACT_FOR_NODE: Partial<Record<GraphNodeType, ArtifactType>> = {
  REQUIREMENT: 'requirement-spec',
  FEATURE: 'architecture-plan',
  MODULE: 'backend-source',
  SERVICE: 'backend-source',
  API: 'api-contract',
  ENTITY: 'database-design',
  FIELD: 'database-design',
  COMPONENT: 'frontend-source',
  SECURITY_RULE: 'security-report',
  FILE: 'project-files',
  TEST: 'project-files',
};

/** Artifacts a task always wants, regardless of which nodes were selected. */
const ALWAYS_FOR_TASK: Record<TaskType, ArtifactType[]> = {
  REQUIREMENT_ANALYSIS: [],
  PRODUCT_PLANNING: ['requirement-spec'],
  ARCHITECTURE_PLANNING: ['requirement-spec'],
  DATABASE_DESIGN: ['architecture-plan'],
  BACKEND_GENERATION: ['architecture-plan', 'database-design'],
  FRONTEND_GENERATION: ['api-contract', 'database-design'],
  // The security reviewer reads what the system exposes and what
  // implements it. Source arrives through the agent's own inputs, not the
  // context budget — a whole backend does not belong in a prompt.
  SECURITY_REVIEW: ['architecture-plan', 'api-contract'],
  DEPENDENCY_REVIEW: ['backend-config', 'frontend-config'],
  QUALITY_REVIEW: ['architecture-plan', 'backend-metadata', 'frontend-metadata'],
  TEST_PLANNING: ['product-spec', 'api-contract'],
  REPAIR: ['api-contract'],
  // The reviewer needs what the product promised and what the frontend
  // actually built. Backend source is deliberately absent: a UX finding
  // about a controller would be a finding about the wrong thing.
  UX_REVIEW: ['product-spec', 'frontend-metadata'],
  CODE_REVIEW: [],
  IMPACT_EXPLANATION: [],
};

export interface ArtifactSelection {
  needed: ArtifactType[];
  excluded: { type: ArtifactType; reason: 'not-relevant' }[];
}

const ALL: ArtifactType[] = [
  'requirement-spec',
  'architecture-plan',
  'architecture-markdown',
  'database-design',
  'api-contract',
  'backend-source',
  'frontend-source',
  'security-report',
  'dependency-graph',
  'project-files',
];

export function selectArtifacts(
  task: TaskType,
  selected: ScoredNode[],
  explicit: ArtifactType[] | undefined,
  includeSourceFiles: boolean,
): ArtifactSelection {
  if (explicit && explicit.length > 0) {
    return {
      needed: explicit,
      excluded: ALL.filter((type) => !explicit.includes(type)).map((type) => ({
        type,
        reason: 'not-relevant' as const,
      })),
    };
  }

  const needed = new Set<ArtifactType>(ALWAYS_FOR_TASK[task]);
  for (const entry of selected) {
    const artifact = ARTIFACT_FOR_NODE[entry.node.type];
    if (artifact) needed.add(artifact);
  }

  // Source bundles are the largest artifacts by far; they come only when
  // the task said it needs to read code.
  if (!includeSourceFiles) {
    needed.delete('project-files');
    needed.delete('backend-source');
    needed.delete('frontend-source');
  }
  // Prose duplicates the structured plan; the structured form always wins.
  needed.delete('architecture-markdown');

  return {
    needed: [...needed],
    excluded: ALL.filter((type) => !needed.has(type)).map((type) => ({
      type,
      reason: 'not-relevant' as const,
    })),
  };
}
