/**
 * Requirement Analyst — wraps the existing analyzer.
 *
 * The underlying logic is untouched: `analyzeWithAi` already makes one
 * model call through the AI orchestrator and falls back to the rule-based
 * analyzer when no model is reachable. This adapter gives it an agent's
 * contract — a declared output, structured findings, classified failures —
 * without rewriting a line of what it does.
 *
 * It requests no context, and that is correct rather than an omission:
 * this agent runs first, from the user's prompt, before any graph exists
 * to select from.
 *
 * The richer planning fields — goal, functional and non-functional
 * requirements, constraints, assumptions, acceptance criteria — are merged
 * on from the model's own response. They are optional on the type, so the
 * deterministic pipeline that reads only the legacy fields is unaffected.
 */
import { analyzeWithAi, deriveProjectName } from '../../pipeline/lib/ai-stages.js';
import { mergeRequirementDetail } from '../lib/spec-normalizers.js';
import { AgentError } from '../lib/executor.js';
import type {
  Agent,
  AgentExecutionInput,
  AgentFinding,
  AgentResult,
} from '../../../shared/contracts/index.js';
import { getAgentDefinition } from '../../../shared/contracts/index.js';
import type { RequirementSpec } from '../../../shared/types/requirement.js';

const definition = getAgentDefinition('requirement-analyst');
if (!definition) throw new Error('requirement-analyst is not declared');

export const requirementAnalystAgent: Agent<RequirementSpec> = {
  definition,

  async execute(input: AgentExecutionInput): Promise<AgentResult<RequirementSpec>> {
    const startedAt = Date.now();
    const projectName = deriveProjectName(input.prompt);

    const outcome = await analyzeWithAi(input.prompt, projectName);

    // `analyzeWithAi` returns the legacy spec shape; the model also emits
    // the planning-mesh detail, which the deterministic path never reads
    // and so never carried through. Merging it here is what gives the
    // downstream agents a goal, constraints and acceptance criteria to
    // reason from rather than a bare module list.
    const spec = mergeRequirementDetail(outcome.value, outcome.raw ?? outcome.value);

    if (spec.database.length === 0) {
      // No entities means every downstream stage has nothing to build.
      // Better to fail here than to emit an empty schema.
      throw new AgentError('invalid-output', 'The analyzer produced no data entities');
    }

    // Gaps the analyzer itself flagged become findings rather than being
    // buried in the spec — this is what the future review system reads.
    const findings: AgentFinding[] = spec.missingRequirements.map((item) => ({
      severity: 'LOW' as const,
      category: 'REQUIREMENTS',
      title: 'Unspecified requirement',
      description: item,
      targetNodeId: null,
      status: 'OPEN' as const,
    }));

    if (outcome.degraded) {
      findings.unshift({
        severity: 'MEDIUM',
        category: 'RELIABILITY',
        title: 'Analysis fell back to built-in rules',
        description: outcome.note ?? 'The model was unavailable for this stage.',
        targetNodeId: null,
        status: 'OPEN',
      });
    }

    return {
      agentId: 'requirement-analyst',
      status: 'succeeded',
      output: spec,
      artifacts: { 'requirement-spec': spec },
      findings,
      error: null,
      failureKind: null,
      durationMs: Date.now() - startedAt,
      usage: outcome.usage
        ? {
            provider: outcome.usage.provider,
            model: outcome.usage.model,
            inputTokens: outcome.usage.inputTokens,
            outputTokens: outcome.usage.outputTokens,
            costUsd: outcome.usage.costUsd,
            contextTokens: 0,
          }
        : null,
    };
  },
};
