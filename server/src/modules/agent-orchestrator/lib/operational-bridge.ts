/**
 * Publishes the agent mesh's own event stream to the operational log.
 *
 * The mesh already records a typed event for everything that happens to a
 * task — queued, started, retried, completed, failed, and the validation
 * gate around them — into a per-run in-memory array that `GET
 * /projects/:id/agent-runs/:runId/events` serves to the console. That stream
 * is good, and it never reached the logger: none of it appeared in the
 * server's own output, so an agent run that went wrong after the browser had
 * closed left no trace anywhere.
 *
 * The fix is a bridge rather than a second set of call sites. Emitting
 * `logEvent` from the twenty-two places that already call `recordEvent`
 * would mean two lists of what the mesh reports, kept in step by hand; this
 * way the mesh keeps one vocabulary and the operational log is derived from
 * it. A kind with no honest operational shape is deliberately not bridged
 * rather than forced into one — the list below says which, and why.
 *
 * Durations are measured here, from the mesh's own start event, because the
 * mesh's records carry wall-clock timestamps and not elapsed time. Where a
 * start was never seen — the buffer evicted it, or the process restarted
 * mid-run — the duration is omitted instead of guessed.
 */
import { logEvent } from '../../../shared/logger/events.js';
import type { AgentEventType } from '../agent-orchestrator.types.js';
import type { AgentId } from '../../../shared/contracts/agent.js';

export interface BridgeOptions {
  taskId?: string | null;
  agentId?: AgentId | null;
  detail?: Record<string, unknown>;
}

/**
 * Monotonic start times, keyed by the task they belong to.
 *
 * Bounded so a run that starts thousands of tasks and finishes none cannot
 * grow the process: entries are removed when consumed, and the oldest is
 * dropped if the map is ever pushed past its ceiling.
 */
const startedAt = new Map<string, number>();
const MAX_TRACKED_TASKS = 500;

function noteStart(taskId: string | null | undefined): void {
  if (taskId === null || taskId === undefined) return;
  startedAt.set(taskId, performance.now());
  while (startedAt.size > MAX_TRACKED_TASKS) {
    const oldest = startedAt.keys().next().value;
    if (oldest === undefined) break;
    startedAt.delete(oldest);
  }
}

/** Elapsed ms since this task's start event, or undefined if none was seen. */
function takeDuration(taskId: string | null | undefined): number | undefined {
  if (taskId === null || taskId === undefined) return undefined;
  const began = startedAt.get(taskId);
  if (began === undefined) return undefined;
  startedAt.delete(taskId);
  return Math.round(performance.now() - began);
}

function text(detail: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = detail?.[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function count(detail: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = detail?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Maps one mesh event onto the operational log, where a mapping exists.
 *
 * Not bridged, on purpose:
 * - `AGENT_QUEUED` — scheduling, not execution. Every queued task also
 *   reports `AGENT_STARTED` when it actually runs, and publishing both would
 *   double every agent in the timeline.
 * - `AI_REQUEST_STARTED` / `AI_REQUEST_COMPLETED` — the provider call is
 *   already published as `model.call` by the orchestrator's request logger,
 *   with the usage and cost figures these two do not carry. Bridging them
 *   would count every model call twice.
 * - `CONTEXT_RESOLVED`, `ARTIFACT_CREATED`, `GRAPH_UPDATED`,
 *   `FINDINGS_RECORDED` — bookkeeping with no measured duration and no
 *   outcome to report. They remain in the mesh's own stream, which the
 *   console reads.
 * - `AGENT_CANCELLED` — recorded at run level with no `agentId` (see
 *   scheduler's cancellation path), so there is no agent to name. A
 *   cancelled *task* arrives as `AGENT_FAILED` with kind `cancelled`, which
 *   is bridged.
 */
export function bridgeAgentEvent(type: AgentEventType, options: BridgeOptions): void {
  const { taskId, agentId, detail } = options;

  switch (type) {
    case 'AGENT_STARTED': {
      noteStart(taskId);
      if (agentId === null || agentId === undefined) return;
      logEvent({ event: 'agent.start', agentId, role: 'agent-mesh' });
      return;
    }

    case 'AGENT_COMPLETED': {
      const durationMs = takeDuration(taskId);
      if (agentId === null || agentId === undefined) return;
      // A cache hit completed the task without doing the work. Reported as
      // the reason rather than as a separate outcome: the task did complete,
      // and a reader counting completions should still count it.
      const cached = detail?.cached === true;
      logEvent({
        event: 'agent.end',
        agentId,
        outcome: 'completed',
        ...(durationMs === undefined ? {} : { durationMs }),
        ...(cached ? { reason: 'cached' } : {}),
      });
      return;
    }

    case 'AGENT_FAILED': {
      const durationMs = takeDuration(taskId);
      if (agentId === null || agentId === undefined) return;
      const kind = text(detail, 'kind');
      logEvent({
        event: 'agent.end',
        agentId,
        outcome: kind === 'cancelled' ? 'cancelled' : 'failed',
        ...(durationMs === undefined ? {} : { durationMs }),
        ...(kind === undefined ? {} : { reason: kind }),
      });
      return;
    }

    case 'AGENT_RETRY': {
      const attempt = count(detail, 'attempt');
      logEvent({
        event: 'retry',
        target: agentId ?? taskId ?? 'agent',
        attempt: attempt ?? 1,
        ...(text(detail, 'kind') === undefined ? {} : { reason: text(detail, 'kind') }),
      });
      return;
    }

    case 'VALIDATION_STARTED': {
      logEvent({ event: 'validation.start', target: 'agent-mesh gate' });
      return;
    }

    case 'VALIDATION_PASSED':
    case 'VALIDATION_FAILED': {
      // The gate's own verdict is the target, so a reader can tell
      // PASSED_WITH_WARNINGS from PASSED without a second lookup.
      const gate = text(detail, 'gate');
      const issues = count(detail, 'issues');
      logEvent({
        event: 'validation',
        target: gate ?? 'agent-mesh gate',
        outcome: type === 'VALIDATION_PASSED' ? 'passed' : 'failed',
        // Omitted rather than zeroed: the gate reports a verdict, not a
        // count, so `issues: 0` beside a failure said "failed with nothing
        // wrong".
        ...(issues === undefined ? {} : { issues }),
        // A gate that never ran did not block anything. BLOCKED and
        // NOT_VALIDATED are failures to *establish* a verdict, and calling
        // them blocking put them beside a real validation failure.
        blocking: gate !== 'BLOCKED' && gate !== 'NOT_VALIDATED',
        ...(text(detail, 'reason') === undefined ? {} : { reason: text(detail, 'reason') }),
      });
      return;
    }

    default:
      return;
  }
}

/** Drops tracked start times. For tests, which must not inherit each other's. */
export function resetBridgeState(): void {
  startedAt.clear();
}
