/**
 * Product Architect — the layer between "what was asked for" and "how it
 * will be built".
 *
 * This is the one genuinely new reasoning step in the planning mesh. The
 * platform previously went straight from a requirement spec to a technical
 * plan, which meant the product shape — modules, journeys, the rules a
 * developer could not guess — was never stated anywhere. It was implied by
 * the architecture, and an implication is not reviewable.
 *
 * The output names no technology. That constraint is enforced in the
 * prompt and, where it matters, checked here: a product spec that mentions
 * Postgres has skipped its own layer and the architecture agent's job.
 */
import { generateWithContext } from '../../ai-orchestrator/ai-orchestrator.service.js';
import { AgentError } from '../lib/executor.js';
import { getAgentDefinition } from '../../../shared/contracts/index.js';
import { logger } from '../../../shared/logger/index.js';
import type {
  Agent,
  AgentExecutionInput,
  AgentFinding,
  AgentResult,
} from '../../../shared/contracts/index.js';
import type { ProductSpec } from '../../../shared/types/product.js';
import type { RequirementSpec } from '../../../shared/types/requirement.js';
import { normalizeProductSpec } from '../lib/spec-normalizers.js';
import { deriveProductSpec } from '../lib/product-fallback.js';

const definition = getAgentDefinition('product-architect');
if (!definition) throw new Error('product-architect is not declared');

export const productArchitectAgent: Agent<ProductSpec> = {
  definition,

  async execute(input: AgentExecutionInput): Promise<AgentResult<ProductSpec>> {
    const startedAt = Date.now();

    const spec = input.inputArtifacts['requirement-spec'] as RequirementSpec | undefined;
    if (!spec) {
      throw new AgentError('invalid-input', 'The product architect requires a requirement spec');
    }

    const findings: AgentFinding[] = [];
    let product: ProductSpec | null = null;
    let usage: AgentResult['usage'] = null;

    try {
      const response = await generateWithContext(
        input.context ?? { text: '', budget: { maxOutputTokens: 4096 } },
        {
          promptId: 'product-architect',
          complexity: 'large-planning',
          schema: 'generic-json',
          variables: {
            PROJECT_NAME: spec.projectName,
            PROJECT_TYPE: spec.projectType,
            GOAL: spec.goal ?? `A ${spec.projectType} application.`,
            ROLES: spec.roles.join(', ') || 'User, Admin',
            MODULES: spec.modules.join(', '),
            FUNCTIONAL: (spec.functionalRequirements ?? spec.modules).join('; '),
            CONSTRAINTS: (spec.constraints ?? []).join('; ') || 'None stated.',
          },
        },
      );

      product = normalizeProductSpec(JSON.parse(response.content), spec);
      usage = {
        provider: response.record.provider,
        model: response.record.model,
        inputTokens: response.record.tokens.inputTokens,
        outputTokens: response.record.tokens.outputTokens,
        costUsd: response.record.cost.totalCostUsd,
        contextTokens: input.context?.tokens ?? 0,
      };
    } catch (error) {
      // A product spec is derivable from the requirement without a model —
      // less insightful, but structurally complete. Degrading beats
      // stopping the mesh at its second step.
      logger.warn('product architect fell back to derivation', { error });
      product = deriveProductSpec(spec);
      findings.push({
        severity: 'MEDIUM',
        category: 'RELIABILITY',
        title: 'Product structure fell back to built-in rules',
        description:
          'The model was unavailable or returned unusable output; the product spec was derived from the requirement instead.',
        targetNodeId: null,
        status: 'OPEN',
      });
    }

    if (product.modules.length === 0) {
      throw new AgentError('invalid-output', 'The product spec contains no modules');
    }

    // A dependency naming a module that does not exist would produce a
    // dangling edge in the graph and a false relationship in the UI.
    const known = new Set(product.modules.map((module) => module.name.toLowerCase()));
    for (const module of product.modules) {
      const dangling = module.dependsOn.filter((name) => !known.has(name.toLowerCase()));
      if (dangling.length > 0) {
        findings.push({
          severity: 'LOW',
          category: 'PRODUCT',
          title: `"${module.name}" depends on modules that do not exist`,
          description: `Dropped: ${dangling.join(', ')}.`,
          targetNodeId: null,
          status: 'OPEN',
        });
        module.dependsOn = module.dependsOn.filter((name) => known.has(name.toLowerCase()));
      }
    }

    return {
      agentId: 'product-architect',
      status: 'succeeded',
      output: product,
      artifacts: { 'product-spec': product },
      findings,
      error: null,
      failureKind: null,
      durationMs: Date.now() - startedAt,
      usage,
    };
  },
};
