/**
 * Database Architect — wraps the existing designer.
 *
 * Deterministic: same plan and spec, same schema, no model call and no
 * token cost. It is an agent anyway because the orchestrator should not
 * care whether a step reasons or computes — scheduling, dependencies,
 * timeouts, validation and isolation apply identically, and a stage that
 * opted out of them would be the one that broke a run.
 *
 * It emits the schema alone. The designer also computes an OpenAPI
 * document, but that artifact belongs to the API Architect downstream —
 * one artifact, one owner, so a regenerated contract has one author.
 */
import { designDatabase } from '../../database-designer/database-designer.service.js';
import { AgentError } from '../lib/executor.js';
import { getAgentDefinition } from '../../../shared/contracts/index.js';
import type {
  Agent,
  AgentExecutionInput,
  AgentFinding,
  AgentResult,
} from '../../../shared/contracts/index.js';
import type { ArchitecturePlan } from '../../../shared/types/architecture.js';
import type { DesignBundle } from '../../../shared/types/design.js';
import type { RequirementSpec } from '../../../shared/types/requirement.js';

const definition = getAgentDefinition('database-architect');
if (!definition) throw new Error('database-architect is not declared');

export const databaseArchitectAgent: Agent<DesignBundle> = {
  definition,

  async execute(input: AgentExecutionInput): Promise<AgentResult<DesignBundle>> {
    const startedAt = Date.now();
    await Promise.resolve(); // keeps the signature honest for an async contract

    const plan = input.inputArtifacts['architecture-plan'] as ArchitecturePlan | undefined;
    const spec = input.inputArtifacts['requirement-spec'] as RequirementSpec | undefined;
    if (!plan || !spec) {
      throw new AgentError(
        'invalid-input',
        'The database designer requires an architecture plan and a requirement specification',
      );
    }

    const bundle = designDatabase(plan, spec);

    if (!bundle.integrity.valid) {
      // The designer checks its own output; a failed integrity check is a
      // real defect, not a warning to pass downstream.
      throw new AgentError(
        'validation-failed',
        `The generated schema failed its integrity check: ${bundle.integrity.issues
          .slice(0, 2)
          .map((issue) => issue.message)
          .join('; ')}`,
      );
    }

    const findings: AgentFinding[] = bundle.integrity.issues.map((issue) => ({
      severity: 'LOW' as const,
      category: 'DATABASE',
      title: 'Schema integrity note',
      description: issue.message,
      targetNodeId: null,
      status: 'OPEN' as const,
    }));

    return {
      agentId: 'database-architect',
      status: 'succeeded',
      output: bundle,
      // The schema only. The OpenAPI contract this designer also computes
      // belongs to the API Architect, which owns that artifact and checks
      // it against every upstream spec.
      artifacts: { 'database-design': bundle.databaseDesign },
      findings,
      error: null,
      failureKind: null,
      durationMs: Date.now() - startedAt,
      usage: null,
    };
  },
};
