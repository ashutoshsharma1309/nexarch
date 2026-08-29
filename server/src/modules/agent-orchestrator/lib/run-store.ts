/**
 * Run and task state, plus the event log.
 *
 * Process-local and bounded, matching every other generator cache in this
 * platform — and matching the artifacts these runs produce, which are also
 * process-local. Persisting task state while its artifacts evaporate on
 * restart would produce runs that claim to be resumable and are not.
 *
 * The event log is append-only and capped per run: it is a narrative of
 * what happened, and an unbounded one on a failing loop is its own problem.
 */
import type {
  AgentEvent,
  AgentEventType,
  AgentRun,
  AgentTask,
  RunProgress,
} from '../agent-orchestrator.types.js';
import type { AgentId, ArtifactType } from '../../../shared/contracts/index.js';

interface RunState {
  run: AgentRun;
  /** Artifacts produced so far, keyed by type — the DAG's data plane. */
  artifacts: Partial<Record<ArtifactType, unknown>>;
  events: AgentEvent[];
  controller: AbortController;
  nextSeq: number;
}

const MAX_RUNS = 20;
const MAX_EVENTS_PER_RUN = 500;

const runs = new Map<string, RunState>();

export function createRun(run: AgentRun, controller: AbortController): void {
  runs.set(run.id, { run, artifacts: {}, events: [], controller, nextSeq: 1 });
  while (runs.size > MAX_RUNS) {
    const oldest = runs.keys().next().value;
    if (oldest === undefined) break;
    runs.delete(oldest);
  }
}

export function getRunState(runId: string): RunState | undefined {
  return runs.get(runId);
}

export function listRuns(ownerId: string): AgentRun[] {
  return [...runs.values()]
    .map((state) => state.run)
    .filter((run) => run.ownerId === ownerId)
    .reverse();
}

export function touch(run: AgentRun): void {
  run.updatedAt = new Date().toISOString();
}

export function findTask(run: AgentRun, taskId: string): AgentTask | undefined {
  return run.tasks.find((task) => task.id === taskId);
}

/* ── Artifacts ────────────────────────────────────────────────────────── */

export function storeArtifacts(
  runId: string,
  artifacts: Partial<Record<ArtifactType, unknown>>,
): void {
  const state = runs.get(runId);
  if (!state) return;
  Object.assign(state.artifacts, artifacts);
}

export function artifactsOf(runId: string): Partial<Record<ArtifactType, unknown>> {
  return runs.get(runId)?.artifacts ?? {};
}

/* ── Events ───────────────────────────────────────────────────────────── */

export function recordEvent(
  runId: string,
  type: AgentEventType,
  options: {
    taskId?: string | null;
    agentId?: AgentId | null;
    detail?: Record<string, unknown>;
  } = {},
): void {
  const state = runs.get(runId);
  if (!state) return;

  state.events.push({
    seq: state.nextSeq,
    runId,
    taskId: options.taskId ?? null,
    agentId: options.agentId ?? null,
    type,
    at: new Date().toISOString(),
    detail: options.detail ?? {},
  });
  state.nextSeq += 1;

  if (state.events.length > MAX_EVENTS_PER_RUN) state.events.shift();
}

export function eventsOf(runId: string, after = 0): AgentEvent[] {
  return (runs.get(runId)?.events ?? []).filter((event) => event.seq > after);
}

/* ── Cancellation ─────────────────────────────────────────────────────── */

export function abortRun(runId: string): void {
  runs.get(runId)?.controller.abort();
}

export function signalOf(runId: string): AbortSignal {
  return runs.get(runId)?.controller.signal ?? new AbortController().signal;
}

/** A cancelled run gets a fresh controller so it can be resumed. */
export function renewController(runId: string): void {
  const state = runs.get(runId);
  if (state) state.controller = new AbortController();
}

/* ── Derived state ────────────────────────────────────────────────────── */

/** Counted from tasks every time. Nothing about progress is stored. */
export function progressOf(run: AgentRun): RunProgress {
  const count = (status: AgentTask['status']): number =>
    run.tasks.filter((task) => task.status === status).length;

  return {
    total: run.tasks.length,
    completed: count('COMPLETED'),
    failed: count('FAILED'),
    blocked: count('BLOCKED'),
    cancelled: count('CANCELLED'),
    running: count('RUNNING'),
    pending: count('PENDING') + count('READY'),
  };
}

export function resetStoreForTests(): void {
  runs.clear();
}
