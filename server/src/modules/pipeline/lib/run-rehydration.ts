/**
 * Rebuilds a finished run from its recorded events.
 *
 * Stage state lives in memory while a run is active, so after a restart the
 * events are the only account of what each stage did. Nothing is inferred
 * beyond them: a run recorded before events existed has stages with no
 * history, and they read that way.
 */
import { config } from '../../../shared/config/index.js';
import { prisma } from '../../../shared/database/prisma.js';
import { logger } from '../../../shared/logger/index.js';
import {
  listExecutionEvents,
  listStageUsage,
} from '../../execution-events/execution-events.service.js';
import type {
  ExecutionEvent,
  StageUsageRecord,
} from '../../execution-events/execution-events.types.js';
import type { PipelineRun, PipelineStage } from '../pipeline.types.js';

const NOT_RUNNING = 'This run is no longer running on this server.';

async function allEvents(jobId: string): Promise<ExecutionEvent[]> {
  const events: ExecutionEvent[] = [];
  for (;;) {
    const page = await listExecutionEvents(jobId, events.at(-1)?.seq ?? 0);
    events.push(...page);
    if (page.length < 500) return events;
  }
}

function applyEvent(stage: PipelineStage, event: ExecutionEvent): void {
  const data = event.data ?? {};
  const durationMs = typeof data.durationMs === 'number' ? data.durationMs : null;
  switch (event.type) {
    case 'stage.started':
      stage.status = 'running';
      stage.startedAt = event.createdAt;
      break;
    case 'stage.completed':
      stage.status = 'completed';
      stage.completedAt = event.createdAt;
      stage.durationMs = durationMs;
      stage.summary = typeof data.summary === 'string' ? data.summary : null;
      stage.degraded = data.degraded === true;
      break;
    case 'stage.failed':
      stage.status = 'failed';
      stage.completedAt = event.createdAt;
      stage.durationMs = durationMs;
      stage.error = typeof data.error === 'string' ? data.error : null;
      break;
    case 'stage.skipped':
      stage.status = 'skipped';
      stage.completedAt = event.createdAt;
      stage.summary = typeof data.reason === 'string' ? data.reason : null;
      break;
    default:
      break;
  }
}

/** A stage left open by the events belonged to a process that is gone. */
export function replayStages(
  stages: PipelineStage[],
  events: readonly ExecutionEvent[],
  completed: boolean,
): void {
  const byId = new Map(stages.map((stage) => [stage.id as string, stage]));
  for (const event of events) {
    const stage = event.stage === null ? undefined : byId.get(event.stage);
    if (stage) applyEvent(stage, event);
  }
  for (const stage of stages) {
    if (stage.status === 'pending' && !completed) stage.status = 'skipped';
    if (stage.status === 'running') {
      stage.status = 'failed';
      stage.error = NOT_RUNNING;
    }
  }
}

/** Null when the run does not exist, is not this user's, or there is no database. */
export async function restoreRunFromEvents(
  id: string,
  ownerId: string,
  stages: PipelineStage[],
): Promise<PipelineRun | null> {
  if (!config.database.enabled) return null;
  try {
    const row = await prisma.generation.findFirst({
      where: { id, project: { ownerId } },
      include: { project: { select: { name: true } } },
    });
    if (!row) return null;

    const [events, usage] = await Promise.all([allEvents(id), listStageUsage(id)]);
    const completed = row.status === 'COMPLETED';
    replayStages(stages, events, completed);

    const last = usage.at(-1);
    return {
      id: row.id,
      projectId: row.projectId,
      projectName: row.project.name,
      prompt: row.prompt,
      status: completed ? 'completed' : 'failed',
      stages,
      // The row keeps only the sentence, not which kind of shortfall it was.
      ...(completed && row.error
        ? { outcome: 'unverified' as const, outcomeDetail: row.error }
        : {}),
      ai: {
        calls: usage.filter((entry) => entry.provider !== null).length,
        provider: last?.provider ?? 'none',
        model: last?.model ?? 'none',
        inputTokens: usage.reduce((sum, entry) => sum + (entry.inputTokens ?? 0), 0),
        outputTokens: usage.reduce((sum, entry) => sum + (entry.outputTokens ?? 0), 0),
        estimatedCostUsd: Number(
          usage.reduce((sum, entry) => sum + (entry.costUsd ?? 0), 0).toFixed(6),
        ),
      },
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      error: completed ? null : (row.error ?? NOT_RUNNING),
    };
  } catch (error) {
    logger.warn('run could not be restored from its events', { runId: id, error });
    return null;
  }
}

/**
 * Makes a run's totals agree with what was billed. A call that fails after
 * paying for rejected attempts returns no record, so only the usage rows saw
 * that spend. Rows win only when they show more: with no database, or rows
 * still being written, they would undercount a run that has real totals.
 */
export function adoptBilledUsage(ai: PipelineRun['ai'], rows: readonly StageUsageRecord[]): void {
  const inputTokens = rows.reduce((sum, row) => sum + (row.inputTokens ?? 0), 0);
  const outputTokens = rows.reduce((sum, row) => sum + (row.outputTokens ?? 0), 0);
  if (inputTokens + outputTokens <= ai.inputTokens + ai.outputTokens) return;
  ai.inputTokens = inputTokens;
  ai.outputTokens = outputTokens;
  ai.calls = Math.max(ai.calls, rows.filter((row) => row.provider !== null).length);
  ai.estimatedCostUsd = Math.max(
    ai.estimatedCostUsd,
    Number(rows.reduce((sum, row) => sum + (row.costUsd ?? 0), 0).toFixed(6)),
  );
}
