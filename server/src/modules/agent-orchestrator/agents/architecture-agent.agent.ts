/**
 * Architecture Agent — wraps the existing planner.
 *
 * `planArchitecture` builds the plan deterministically and
 * `designEntityFields` designs the entity columns with one model call.
 * Both are unchanged; this adapter composes them and, unlike the pipeline
 * stage, asks the Context Engine for context first.
 *
 * That context request is real but usually thin on a first run — the graph
 * describing this project does not exist until later. On a *rebuild* it is
 * the previous run's graph, and the agent gets a genuine picture of what
 * the project already looks like. Requesting it unconditionally is what
 * makes that work without a special case.
 */
import { planArchitecture } from '../../architecture/architecture.service.js';
import { designEntityFields } from '../../pipeline/lib/ai-stages.js';
import { AgentError } from '../lib/executor.js';
import { getAgentDefinition } from '../../../shared/contracts/index.js';
import type {
  Agent,
  AgentExecutionInput,
  AgentFinding,
  AgentResult,
} from '../../../shared/contracts/index.js';
import type { ArchitecturePlan } from '../../../shared/types/architecture.js';
import type { RequirementSpec } from '../../../shared/types/requirement.js';

const definition = getAgentDefinition('architecture-agent');
if (!definition) throw new Error('architecture-agent is not declared');

export const architectureAgent: Agent<ArchitecturePlan> = {
  definition,

  async execute(input: AgentExecutionInput): Promise<AgentResult<ArchitecturePlan>> {
    const startedAt = Date.now();

    const spec = input.inputArtifacts['requirement-spec'] as RequirementSpec | undefined;
    if (!spec) {
      throw new AgentError('invalid-input', 'The architect requires a requirement specification');
    }

    const { plan } = planArchitecture(spec);

    const fields = await designEntityFields(plan.database.entities, {
      projectName: spec.projectName,
      projectType: spec.projectType,
    });
    plan.database.entities = fields.value;

    if (plan.apiModules.length === 0) {
      throw new AgentError('invalid-output', 'The plan plans no API modules');
    }

    const findings: AgentFinding[] = [];
    if (fields.degraded) {
      findings.push({
        severity: 'MEDIUM',
        category: 'RELIABILITY',
        title: 'Entity columns fell back to built-in rules',
        description: fields.note ?? 'The model was unavailable for this stage.',
        targetNodeId: null,
        status: 'OPEN',
      });
    }

    return {
      agentId: 'architecture-agent',
      status: 'succeeded',
      output: plan,
      artifacts: { 'architecture-plan': plan },
      findings,
      error: null,
      failureKind: null,
      durationMs: Date.now() - startedAt,
      usage: fields.usage
        ? {
            provider: fields.usage.provider,
            model: fields.usage.model,
            inputTokens: fields.usage.inputTokens,
            outputTokens: fields.usage.outputTokens,
            costUsd: fields.usage.costUsd,
            contextTokens: input.context?.tokens ?? 0,
          }
        : null,
    };
  },
};
