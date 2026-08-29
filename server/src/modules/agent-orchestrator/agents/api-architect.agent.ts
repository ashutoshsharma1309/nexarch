/**
 * API Architect — the contract between the parts, and the mesh's auditor.
 *
 * The endpoint surface itself is derived, not reasoned: `generateOpenApi`
 * already turns an architecture plan and a schema into a complete OpenAPI
 * document with request bodies, responses, auth and error shapes. Asking a
 * model to restate that would be slower, cost money, and occasionally
 * invent an endpoint for a table that does not exist.
 *
 * What this agent adds beyond wrapping is the consistency pass. It is the
 * last planning agent, so it is the first place where all four upstream
 * specs exist at once — and therefore the only place that can check they
 * agree. Mismatches become findings rather than failures: a plan that
 * contradicts itself is something a person should see, not something this
 * layer gets to reject.
 */
import { generateOpenApi } from '../../database-designer/lib/openapi-generator.js';
import { AgentError } from '../lib/executor.js';
import { checkConsistency } from '../lib/consistency.js';
import { getAgentDefinition } from '../../../shared/contracts/index.js';
import type { Agent, AgentExecutionInput, AgentResult } from '../../../shared/contracts/index.js';
import type { ArchitecturePlan } from '../../../shared/types/architecture.js';
import type { DatabaseDesign, OpenApiDocument } from '../../../shared/types/design.js';
import type { ProductSpec } from '../../../shared/types/product.js';
import type { RequirementSpec } from '../../../shared/types/requirement.js';

const definition = getAgentDefinition('api-architect');
if (!definition) throw new Error('api-architect is not declared');

export const apiArchitectAgent: Agent<OpenApiDocument> = {
  definition,

  async execute(input: AgentExecutionInput): Promise<AgentResult<OpenApiDocument>> {
    const startedAt = Date.now();
    await Promise.resolve();

    const architecture = input.inputArtifacts['architecture-plan'] as ArchitecturePlan | undefined;
    const database = input.inputArtifacts['database-design'] as DatabaseDesign | undefined;
    if (!architecture || !database) {
      throw new AgentError(
        'invalid-input',
        'The API architect requires an architecture plan and a database design',
      );
    }

    const api = generateOpenApi(architecture, database);

    const pathCount = Object.keys(api.paths).length;
    if (pathCount === 0) {
      throw new AgentError('invalid-output', 'The API contract defines no endpoints');
    }

    // Every upstream spec is available here for the first time.
    const findings = checkConsistency({
      requirements: input.inputArtifacts['requirement-spec'] as RequirementSpec | undefined,
      product: input.inputArtifacts['product-spec'] as ProductSpec | undefined,
      architecture,
      database,
      api,
    });

    return {
      agentId: 'api-architect',
      status: 'succeeded',
      output: api,
      artifacts: { 'api-contract': api },
      findings,
      error: null,
      failureKind: null,
      durationMs: Date.now() - startedAt,
      usage: null,
    };
  },
};
