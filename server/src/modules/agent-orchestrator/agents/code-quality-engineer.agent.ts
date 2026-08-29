/**
 * Code Quality Engineer — the generated code against the plan that asked
 * for it.
 *
 * Wraps the existing `analyzeQuality`, which already measures duplication,
 * complexity, file size and dead code over real files, and adds the
 * comparison no generator can make about itself: does the backend contain
 * the modules the architecture planned, does it serve the endpoints the
 * contract declares, are errors being discarded silently.
 *
 * Deterministic throughout. Step 14 ends by ruling out subjective style as
 * a defect, and the surest way to honour that is to have no check whose
 * result depends on taste — every finding here is a count, a comparison,
 * or a construct that is present or absent in a file.
 */
import { getAgentDefinition } from '../../../shared/contracts/index.js';
import { AgentError } from '../lib/executor.js';
import { reviewQuality } from '../lib/quality-review.js';
import type { Agent, AgentExecutionInput, AgentResult } from '../../../shared/contracts/index.js';
import type { ArchitecturePlan } from '../../../shared/types/architecture.js';
import type { OpenApiDocument } from '../../../shared/types/design.js';
import type { RequirementSpec } from '../../../shared/types/requirement.js';
import type { QualityReview } from '../lib/quality-review.js';

const definition = getAgentDefinition('code-quality-engineer');
if (!definition) throw new Error('code-quality-engineer is not declared');

interface FileArtifact {
  files: { path: string; content: string }[];
}

interface BackendMetadata {
  modules: { name: string; entity: string | null }[];
  routes: { method: string; path: string }[];
}

function filesOf(artifact: unknown, prefix: string): { path: string; content: string }[] {
  const value = artifact as FileArtifact | undefined;
  return (value?.files ?? []).map((file) => ({ ...file, path: `${prefix}/${file.path}` }));
}

export const codeQualityEngineerAgent: Agent<QualityReview> = {
  definition,

  async execute(input: AgentExecutionInput): Promise<AgentResult<QualityReview>> {
    const startedAt = Date.now();
    await Promise.resolve();

    const requirements = input.inputArtifacts['requirement-spec'] as RequirementSpec | undefined;
    const architecture = input.inputArtifacts['architecture-plan'] as ArchitecturePlan | undefined;
    const api = input.inputArtifacts['api-contract'] as OpenApiDocument | undefined;
    const backendMeta = input.inputArtifacts['backend-metadata'] as BackendMetadata | undefined;

    if (!requirements || !architecture || !api || !backendMeta) {
      throw new AgentError(
        'invalid-input',
        'The code quality engineer requires the requirement spec, architecture, API contract and the backend manifest',
      );
    }

    const backendFiles = filesOf(input.inputArtifacts['backend-source'], 'backend');
    const frontendFiles = filesOf(input.inputArtifacts['frontend-source'], 'frontend');

    if (backendFiles.length === 0 && frontendFiles.length === 0) {
      throw new AgentError(
        'invalid-input',
        'The code quality engineer requires generated source to review',
      );
    }

    const review = reviewQuality({
      projectName: requirements.projectName,
      architecture,
      api,
      backendFiles,
      frontendFiles,
      backendModules: backendMeta.modules,
      backendRoutes: backendMeta.routes,
    });

    return {
      agentId: 'code-quality-engineer',
      status: 'succeeded',
      output: review,
      artifacts: { 'quality-report': review },
      findings: review.findings,
      error: null,
      failureKind: null,
      durationMs: Date.now() - startedAt,
      usage: null,
    };
  },
};
