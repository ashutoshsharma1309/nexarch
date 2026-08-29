/**
 * Repair Engineer — the agent identity behind the repair engine.
 *
 * The engine drives the loop (budgets, retries, rollback live there, not
 * here); this agent is the registered face of the patch-production step,
 * so the catalogue lists it, its work is attributed to it, and a future
 * caller can invoke one repair through the standard agent contract. It
 * receives a plan and produces proposed edits — it applies nothing itself,
 * because applying is the engine's job behind the authorization gate.
 */
import { getAgentDefinition } from '../../../shared/contracts/index.js';
import { AgentError } from '../lib/executor.js';
import { analyzeRootCause } from '../lib/repair-analysis.js';
import { produceEdits } from '../lib/repair-strategies.js';
import { getFinding } from '../lib/finding-store.js';
import type { Agent, AgentExecutionInput, AgentResult } from '../../../shared/contracts/index.js';
import type { RepairPlan, RootCauseAnalysis } from '../../../shared/types/repair.js';
import type { StrategyResult } from '../lib/repair-strategies.js';

const definition = getAgentDefinition('repair-engineer');
if (!definition) throw new Error('repair-engineer is not declared');

export const repairEngineerAgent: Agent<StrategyResult> = {
  definition,

  async execute(input: AgentExecutionInput): Promise<AgentResult<StrategyResult>> {
    const startedAt = Date.now();

    const plan = input.inputArtifacts['repair-plan' as never] as RepairPlan | undefined;
    if (!plan) {
      throw new AgentError('invalid-input', 'The repair engineer requires a repair plan');
    }
    const finding = getFinding(input.projectId, plan.findingId);
    if (!finding) {
      throw new AgentError('invalid-input', 'The plan names a finding this project does not hold');
    }

    const rca =
      (input.inputArtifacts['root-cause' as never] as RootCauseAnalysis | undefined) ??
      analyzeRootCause(finding);

    const result = await produceEdits(finding, rca, plan, input.context?.text ?? '');

    return {
      agentId: 'repair-engineer',
      status: 'succeeded',
      output: result,
      artifacts: {},
      findings: [],
      error: null,
      failureKind: null,
      durationMs: Date.now() - startedAt,
      usage: result.usage,
    };
  },
};
