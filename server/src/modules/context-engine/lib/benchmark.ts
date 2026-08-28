/**
 * Full context versus selective context, measured on the same task.
 *
 * The reduction figure this platform reports has to be reproducible, so it
 * is produced here by running both arms against the same project, the same
 * graph and the same task, and counting tokens with the same tokenizer.
 *
 * Both arms may optionally make a real model call. That part matters: a
 * context-selection system that halves tokens while halving answer quality
 * has not improved anything, and the only way to see that is to send both
 * and compare what comes back. When `callModel` is false the benchmark
 * reports context size alone and says so by leaving `call` null — an
 * unmeasured number is never invented.
 */
import { generateWithContext } from '../../ai-orchestrator/ai-orchestrator.service.js';
import { logger } from '../../../shared/logger/index.js';
import { buildContext } from '../context-engine.service.js';
import type {
  BenchmarkArm,
  BenchmarkResult,
  ContextMode,
  ContextRequest,
} from '../context-engine.types.js';

async function runArm(
  ownerId: string,
  request: ContextRequest,
  mode: ContextMode,
  callModel: boolean,
): Promise<BenchmarkArm> {
  const context = await buildContext(ownerId, { ...request, mode });

  const arm: BenchmarkArm = {
    mode,
    contextTokens: context.tokens,
    contextChars: context.text.length,
    selectedNodes: context.trace.selected.length,
    selectedArtifacts: context.trace.artifactsIncluded.length,
    call: null,
  };

  if (!callModel) return arm;

  const startedAt = Date.now();
  try {
    const response = await generateWithContext(context, {
      promptId: 'context-task',
      complexity: 'large-planning',
      schema: 'generic-json',
      variables: { TASK: request.taskType, INSTRUCTION: request.instruction ?? '' },
    });
    arm.call = {
      inputTokens: response.record.tokens.inputTokens,
      outputTokens: response.record.tokens.outputTokens,
      totalTokens: response.record.tokens.inputTokens + response.record.tokens.outputTokens,
      latencyMs: Date.now() - startedAt,
      costUsd: response.record.cost.totalCostUsd,
      outputValid: response.record.validation.valid,
    };
  } catch (error) {
    // A failed arm is reported as a failed arm, not silently dropped —
    // otherwise the comparison quietly becomes one-sided.
    logger.warn('benchmark arm failed', { mode, error });
    arm.call = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      latencyMs: Date.now() - startedAt,
      costUsd: 0,
      outputValid: false,
    };
  }
  return arm;
}

export async function runBenchmark(
  ownerId: string,
  request: ContextRequest,
  options: { callModel?: boolean } = {},
): Promise<BenchmarkResult> {
  const callModel = options.callModel ?? false;

  // Sequential on purpose: two concurrent calls to the same provider would
  // make the latency numbers meaningless.
  const full = await runArm(ownerId, request, 'FULL', callModel);
  const selective = await runArm(ownerId, request, 'SELECTIVE', callModel);

  const contextReductionPercent =
    full.contextTokens > 0
      ? Math.round(((full.contextTokens - selective.contextTokens) / full.contextTokens) * 10000) /
        100
      : 0;

  const totalTokenReductionPercent =
    full.call && selective.call && full.call.totalTokens > 0
      ? Math.round(
          ((full.call.totalTokens - selective.call.totalTokens) / full.call.totalTokens) * 10000,
        ) / 100
      : null;

  return {
    taskType: request.taskType,
    projectId: request.projectId,
    full,
    selective,
    contextReductionPercent,
    totalTokenReductionPercent,
    measuredAt: new Date().toISOString(),
  };
}
