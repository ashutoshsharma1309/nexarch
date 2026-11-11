/**
 * The agent mesh's half of execution visibility.
 *
 * The in-memory event log in `run-store.ts` dies with the process and is
 * shaped for the agent panel. These events are the durable, project-wide
 * timeline, published only after the thing they describe has happened.
 *
 * Imports the execution-events service directly: its module index loads the
 * router, which imports the pipeline, and that would be an import loop.
 */
import { randomUUID } from 'node:crypto';

import { publishExecutionEvent } from '../../execution-events/execution-events.service.js';
import type { PublishExecutionEventInput } from '../../execution-events/execution-events.types.js';
import type { AgentId, AgentUsage } from '../../../shared/contracts/index.js';
import type { ResearchArtifact } from '../../web-research/index.js';
import type { AgentRun } from '../agent-orchestrator.types.js';

const MAX_RESEARCH_EVENTS = 30;
const MAX_TRACKED_JOBS = 200;

const STAGES: Partial<Record<AgentId, string>> = {
  'requirement-analyst': 'analysis',
  'research-agent': 'research',
  'product-architect': 'planning',
  'architecture-agent': 'planning',
  'database-architect': 'planning',
  'api-architect': 'planning',
  'backend-engineer': 'generation',
  'design-intelligence': 'design',
  'frontend-engineer': 'generation',
  'ux-ui-engineer': 'design',
  'security-engineer': 'review',
  'dependency-engineer': 'review',
  'code-quality-engineer': 'review',
  'runtime-engineer': 'testing',
  'integration-engineer': 'testing',
  'test-engineer': 'testing',
  'repair-engineer': 'repairing',
};

export function meshStageOf(agentId: AgentId): string {
  return STAGES[agentId] ?? 'agents';
}

type Publishable = Omit<PublishExecutionEventInput, 'projectId' | 'jobKind' | 'jobId'>;

export function publishForRun(run: AgentRun, event: Publishable): void {
  void publishExecutionEvent({
    projectId: run.projectId,
    jobKind: 'RUN',
    jobId: run.executionJobId ?? run.id,
    ...event,
  });
}

/**
 * Which jobs already announced a start and an ending.
 *
 * The contract allows one of each per job. A resumed run is a new attempt
 * with its own timeline, because readers stop at a job's terminal event and
 * would never see anything published after it.
 */
const lifecycle = new Map<string, { started: boolean; ended: boolean }>();

function lifecycleOf(runId: string): { started: boolean; ended: boolean } {
  const known = lifecycle.get(runId);
  if (known) return known;
  const created = { started: false, ended: false };
  lifecycle.set(runId, created);
  while (lifecycle.size > MAX_TRACKED_JOBS) {
    const oldest = lifecycle.keys().next().value;
    if (oldest === undefined) break;
    lifecycle.delete(oldest);
  }
  return created;
}

export function publishJobStarted(run: AgentRun): void {
  const state = lifecycleOf(run.id);
  if (state.started && !state.ended) {
    publishForRun(run, { type: 'note', status: 'info', message: 'The agent run was resumed.' });
    return;
  }
  const resumed = state.started;
  if (resumed) run.executionJobId = randomUUID();
  state.started = true;
  state.ended = false;
  publishForRun(run, {
    type: 'job.started',
    status: 'started',
    message: resumed
      ? `Resumed agent run ${run.id}.`
      : `Agent run started with ${String(run.tasks.length)} planned agents.`,
    data: resumed ? { resumedFrom: run.id } : {},
  });
}

export function publishJobSettled(
  run: AgentRun,
  status: 'COMPLETED' | 'FAILED' | 'CANCELLED',
  durationMs: number,
): void {
  const state = lifecycleOf(run.id);
  if (state.ended) {
    publishForRun(run, {
      type: 'note',
      status: 'info',
      message: `The resumed agent run settled as ${status.toLowerCase()}.`,
    });
    return;
  }
  state.ended = true;

  if (status === 'COMPLETED') {
    publishForRun(run, {
      type: 'job.completed',
      status: 'succeeded',
      message: 'Agent run completed.',
      data: { durationMs },
    });
  } else if (status === 'CANCELLED') {
    publishForRun(run, {
      type: 'job.cancelled',
      status: 'cancelled',
      message: 'Agent run cancelled.',
      data: {},
    });
  } else {
    const error = run.error ?? 'The agent run failed';
    publishForRun(run, { type: 'job.failed', status: 'failed', message: error, data: { error } });
  }
}

/**
 * Says which model an agent used. Only the timeline line: the tokens were
 * recorded where the calls happened, so this must not record them again.
 */
export function publishModelUse(
  run: AgentRun,
  agentId: AgentId,
  usage: AgentUsage | null,
  durationMs: number,
): void {
  if (!usage) return;
  publishForRun(run, {
    type: 'model.call',
    status: 'succeeded',
    stage: meshStageOf(agentId),
    agentId,
    message: `${agentId} used ${usage.provider}/${usage.model}`,
    data: { provider: usage.provider, model: usage.model, durationMs },
  });
}

/** The research timeline, from what the artifact says really happened. */
export function publishResearch(run: AgentRun, artifact: ResearchArtifact): void {
  for (const query of artifact.queries.slice(0, MAX_RESEARCH_EVENTS)) {
    publishForRun(run, {
      type: 'research.query',
      status: 'info',
      stage: 'research',
      agentId: 'research-agent',
      message: `Searched: ${query.query}`,
      data: { provider: query.provider, query: query.query, results: query.results },
    });
  }
  for (const source of artifact.sources.slice(0, MAX_RESEARCH_EVENTS)) {
    publishForRun(run, {
      type: 'research.source',
      status: 'info',
      stage: 'research',
      agentId: 'research-agent',
      message: `Source: ${source.title}`,
      data: { url: source.url, title: source.title, retrieval: source.retrievalKind },
    });
  }
  for (const detail of artifact.limitations.slice(0, MAX_RESEARCH_EVENTS)) {
    publishForRun(run, {
      type: 'research.limitation',
      status: 'info',
      stage: 'research',
      agentId: 'research-agent',
      message: detail,
      data: { detail },
    });
  }
}

export function resetExecutionPublisherForTests(): void {
  lifecycle.clear();
}
