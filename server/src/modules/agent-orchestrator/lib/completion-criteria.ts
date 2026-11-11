/**
 * What "done" means for each agent, measured against what it returned.
 *
 * An agent reporting success says only that it did not throw. These checks
 * read the artifacts themselves, so a run can show that an architect who
 * returned no modules finished without meeting its bar. They record rather
 * than fail: the structural contract in `executor.ts` already rejects missing
 * output, and an agent that throws on a soft miss would take its whole
 * downstream with it.
 */
import { SITE_DESIGN_ARTIFACT } from '../../../shared/contracts/agent-registry.js';
import type { AgentId, ArtifactType } from '../../../shared/contracts/index.js';
import type { CompletionOutcome } from '../agent-orchestrator.types.js';

type Artifacts = Partial<Record<ArtifactType, unknown>>;

export interface CompletionCriterion {
  id: string;
  description: string;
  met: (artifacts: Artifacts) => boolean;
}

function field(artifacts: Artifacts, type: ArtifactType, key: string): unknown {
  const value = artifacts[type] as Record<string, unknown> | undefined;
  return value?.[key];
}

function hasItems(artifacts: Artifacts, type: ArtifactType, key: string): boolean {
  const value = field(artifacts, type, key);
  return Array.isArray(value) && value.length > 0;
}

function isList(artifacts: Artifacts, type: ArtifactType, key: string): boolean {
  return Array.isArray(field(artifacts, type, key));
}

function isMeasured(artifacts: Artifacts, type: ArtifactType, key: string): boolean {
  return typeof field(artifacts, type, key) === 'string';
}

function hasPaths(artifacts: Artifacts): boolean {
  const paths = field(artifacts, 'api-contract', 'paths');
  return typeof paths === 'object' && paths !== null && Object.keys(paths).length > 0;
}

function hasSections(artifacts: Artifacts): boolean {
  const design = field(artifacts, SITE_DESIGN_ARTIFACT, 'siteDesign') as
    { sections?: unknown[] } | undefined;
  return (design?.sections?.length ?? 0) > 0;
}

const CRITERIA: Partial<Record<AgentId, readonly CompletionCriterion[]>> = {
  'requirement-analyst': [
    {
      id: 'modules-identified',
      description: 'The spec names at least one module',
      met: (a) => hasItems(a, 'requirement-spec', 'modules'),
    },
  ],
  'research-agent': [
    {
      id: 'status-reported',
      description: 'Research states whether it completed',
      met: (a) => isMeasured(a, 'research-artifact', 'status'),
    },
    {
      id: 'limits-explained',
      description: 'Anything short of complete says why',
      met: (a) =>
        field(a, 'research-artifact', 'status') === 'complete' ||
        hasItems(a, 'research-artifact', 'limitations'),
    },
    {
      id: 'engine-ran',
      description: 'The research engine ran to an end',
      met: (a) => field(a, 'research-artifact', 'engineFailed') !== true,
    },
  ],
  'product-architect': [
    {
      id: 'modules-defined',
      description: 'The product has at least one module',
      met: (a) => hasItems(a, 'product-spec', 'modules'),
    },
    {
      id: 'screens-defined',
      description: 'The product has at least one screen',
      met: (a) => hasItems(a, 'product-spec', 'screens'),
    },
  ],
  'architecture-agent': [
    {
      id: 'plan-has-modules',
      description: 'The plan names its API modules',
      met: (a) => isList(a, 'architecture-plan', 'apiModules'),
    },
  ],
  'database-architect': [
    {
      id: 'tables-designed',
      description: 'The schema has at least one table',
      met: (a) => hasItems(a, 'database-design', 'tables'),
    },
  ],
  'api-architect': [
    {
      id: 'endpoints-declared',
      description: 'The contract declares at least one path',
      met: hasPaths,
    },
  ],
  'backend-engineer': [
    {
      id: 'source-emitted',
      description: 'Backend source files were emitted',
      met: (a) => hasItems(a, 'backend-source', 'files'),
    },
  ],
  'design-intelligence': [
    {
      id: 'sections-written',
      description: 'The site design has at least one section',
      met: hasSections,
    },
  ],
  'frontend-engineer': [
    {
      id: 'source-emitted',
      description: 'Frontend source files were emitted',
      met: (a) => hasItems(a, 'frontend-source', 'files'),
    },
    {
      id: 'pages-built',
      description: 'At least one page was built',
      met: (a) => hasItems(a, 'frontend-metadata', 'pages'),
    },
  ],
  'ux-ui-engineer': [
    {
      id: 'review-recorded',
      description: 'The review lists what it found',
      met: (a) => isList(a, 'ux-review', 'findings'),
    },
  ],
  'security-engineer': [
    {
      id: 'source-scanned',
      description: 'The generated source was scanned',
      met: (a) => field(a, 'security-report', 'sourceScan') !== undefined,
    },
  ],
  'dependency-engineer': [
    {
      id: 'manifests-read',
      description: 'At least one package manifest was reviewed',
      met: (a) => hasItems(a, 'dependency-report', 'areas'),
    },
  ],
  'code-quality-engineer': [
    {
      id: 'findings-recorded',
      description: 'The review lists what it found',
      met: (a) => isList(a, 'quality-report', 'findings'),
    },
  ],
  'runtime-engineer': [
    {
      id: 'startup-measured',
      description: 'Startup was attempted and its result recorded',
      met: (a) => isMeasured(a, 'runtime-report', 'startupStatus'),
    },
  ],
  'integration-engineer': [
    {
      id: 'checks-executed',
      description: 'At least one integration check was recorded',
      met: (a) => hasItems(a, 'integration-report', 'checks'),
    },
  ],
  'test-engineer': [
    {
      id: 'cases-recorded',
      description: 'At least one test case was recorded',
      met: (a) => hasItems(a, 'test-report', 'cases'),
    },
  ],
};

export function criteriaFor(agentId: AgentId): readonly CompletionCriterion[] {
  return CRITERIA[agentId] ?? [];
}

/** Measures every criterion. An agent with none reports empty lists, not success. */
export function evaluateCompletion(agentId: AgentId, artifacts: Artifacts): CompletionOutcome {
  const outcome: CompletionOutcome = { met: [], unmet: [] };
  for (const criterion of criteriaFor(agentId)) {
    (criterion.met(artifacts) ? outcome.met : outcome.unmet).push(criterion.id);
  }
  return outcome;
}
