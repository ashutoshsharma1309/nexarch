/**
 * Runs the repair engineer through the standard executor.
 *
 * The engine decides what to attempt and whether it worked. Producing the
 * patch goes through `executeAgent`, so the repair engineer gets the same
 * timeout, output validation and failure isolation as every other agent. An
 * agent failure comes back as "no edits", which the engine already treats as a
 * failed attempt.
 */
import { randomUUID } from 'node:crypto';

import { getAgentDefinition } from '../../../shared/contracts/index.js';
import { buildContext } from '../../context-engine/context-engine.service.js';
import { executeAgent } from './executor.js';
import type { RepairDeps } from './repair-engine.js';
import type { StrategyResult } from './repair-strategies.js';
import type { AgentContextPayload, AgentUsage } from '../../../shared/contracts/index.js';
import type { RootCauseAnalysis } from '../../../shared/types/repair.js';

export interface RepairProducerOptions {
  ownerId: string;
  projectId: string;
  /** Absent for a repair a person started, which belongs to no agent run. */
  runId?: string;
  signal?: AbortSignal;
  onResult?: (usage: AgentUsage | null, durationMs: number) => void;
}

/** A compiled graph slice, or null: no graph yet is the first-run normal. */
async function repairContext(
  options: RepairProducerOptions,
  rca: RootCauseAnalysis,
): Promise<AgentContextPayload | null> {
  try {
    return await buildContext(options.ownerId, {
      projectId: options.projectId,
      taskType: 'REPAIR',
      ...(rca.affectedNodes.length > 0 ? { targetNames: rca.affectedNodes } : {}),
    });
  } catch {
    return null;
  }
}

export function repairProducer(options: RepairProducerOptions): RepairDeps['produce'] {
  return async (_finding, rca, plan) => {
    const definition = getAgentDefinition('repair-engineer');
    if (!definition) throw new Error('repair-engineer is not declared');

    const { result } = await executeAgent(definition, {
      projectId: options.projectId,
      runId: options.runId ?? randomUUID(),
      taskId: randomUUID(),
      prompt: plan.intent,
      inputArtifacts: { ['repair-plan' as never]: plan, ['root-cause' as never]: rca },
      context: await repairContext(options, rca),
      signal: options.signal ?? new AbortController().signal,
    });
    options.onResult?.(result.usage, result.durationMs);

    if (result.status !== 'succeeded' || !result.output) {
      return {
        edits: [],
        strategy: plan.strategy,
        usage: result.usage,
        error: result.error ?? 'The repair engineer produced nothing.',
      };
    }
    return result.output as StrategyResult;
  };
}
