/**
 * Operational events — the handful of facts an after-the-fact diagnosis needs.
 *
 * Free-text log calls answer "what happened" one line at a time; these
 * answer "where did the run go" when the run is already over. The set is
 * deliberately closed: a stage boundary, a model call, a validation
 * outcome, a child process exiting, and a cleanup. Each is a typed shape
 * with a duration, so the lines can be grouped by `requestId` (injected by
 * the logger from the ambient context) and read as one timeline.
 *
 * None of these shapes has a field for a prompt, a model response or a
 * generated file. That is the point: an event cannot carry the payload it
 * describes, only its measurements.
 */
import { logger } from './index.js';
import { recordTimelineEvent } from './timeline.js';

/** Provider-reported token usage. Structurally the orchestrator's `ModelUsage`. */
export interface EventTokens {
  inputTokens: number;
  outputTokens: number;
}

/**
 * How token counts appear on the wire: `usage: { input, output }`.
 *
 * Not `tokens: { inputTokens, outputTokens }`, because the shared redactor
 * masks any key whose name contains `token` — it cannot tell a bearer from
 * a count. The old `logGenerationResult` passed `tokens`, so every line it
 * wrote carried `"tokens":"***"`: the platform has had no token figures in
 * its logs at all. Renaming on the way out keeps the call sites reading in
 * the orchestrator's own vocabulary and still gets the numbers published.
 */
interface WireUsage {
  input: number;
  output: number;
}

export interface StageStartEvent {
  event: 'stage.start';
  /** Stage id as the pipeline names it, e.g. `analysis`. */
  stage: string;
}

export interface StageEndEvent {
  event: 'stage.end';
  stage: string;
  outcome: 'completed' | 'skipped' | 'failed';
  durationMs: number;
  /** Why it skipped or failed — a reason, never the artifact itself. */
  reason?: string | undefined;
}

export interface ModelCallEvent {
  event: 'model.call';
  provider: string;
  model: string;
  outcome: 'success' | 'cached' | 'failed';
  /** What the call was for — the orchestrator's prompt id. */
  operation?: string | undefined;
  /** The caller's own id for this call, to join the line to its record. */
  callId?: string | undefined;
  /**
   * Provider calls this event covers, and retries inside them.
   *
   * Both are optional because a call site that cannot count them must say
   * nothing rather than publish a zero: a reader cannot tell a counted zero
   * from a placeholder, and the placeholder is the common case on a failure
   * path that lost its attempt list.
   */
  calls?: number | undefined;
  retries?: number | undefined;
  durationMs: number;
  /** Omitted unless the provider returned a usage figure; ships as `usage`. */
  tokens?: EventTokens | undefined;
  /**
   * Omitted when no cost applies — a cache hit paid nobody. Explicitly null
   * when the model has no published price: that is a different fact from
   * "free", and collapsing the two would understate spend in the logs the
   * same way it once understated it on screen.
   */
  costUsd?: number | null | undefined;
  reason?: string | undefined;
}

export interface ValidationEvent {
  event: 'validation';
  /** What was validated — a schema id, a file path, a check name. */
  target: string;
  outcome: 'passed' | 'failed';
  /**
   * Omitted where the call site cannot count them. A reader cannot tell a
   * counted zero from a placeholder, and the agent mesh's gate reports a
   * verdict without an issue count — publishing `issues: 0` beside a failed
   * outcome read as "it failed with nothing wrong".
   */
  issues?: number | undefined;
  durationMs?: number | undefined;
  /** True when this outcome blocks the run rather than annotating it. */
  blocking?: boolean | undefined;
}

export interface ProcessExitEvent {
  event: 'process.exit';
  /** The command as it was spawned — arguments stay out, they carry paths and env. */
  command: string;
  /** Null when the process was killed by a signal rather than exiting. */
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
}

export interface CleanupEvent {
  event: 'cleanup';
  /** What was being released: a workspace dir, a runner session, a temp file. */
  target: string;
  outcome: 'removed' | 'skipped' | 'failed';
  durationMs?: number | undefined;
  reason?: string | undefined;
}

/**
 * The run as a whole, so a timeline has a beginning and an end.
 *
 * Stage events say where the time went; these two say whether the thing the
 * user asked for happened at all, and how long the whole attempt took. The
 * counts on `run.end` describe the shape of the outcome — eight stages, one
 * failed, two skipped — without carrying any of what was generated.
 */
export interface RunStartEvent {
  event: 'run.start';
  /** How this run was started, since a retry is not a fresh request. */
  trigger: 'prompt' | 'retry' | 'edit';
  /** How many stages this run intends to execute. */
  stages: number;
}

export interface RunEndEvent {
  event: 'run.end';
  outcome: 'completed' | 'failed';
  durationMs: number;
  completed: number;
  skipped: number;
  failed: number;
  reason?: string | undefined;
}

/**
 * One agent's turn.
 *
 * `degraded` is a third outcome on purpose: an agent that fell back to a
 * deterministic result did not fail, and recording it as success is how a
 * run full of fallbacks reads as a run that worked.
 */
export interface AgentStartEvent {
  event: 'agent.start';
  agentId: string;
  /** The mesh or phase that invoked it — planning, generation, review. */
  role?: string | undefined;
}

export interface AgentEndEvent {
  event: 'agent.end';
  agentId: string;
  /**
   * `cancelled` is its own outcome because a cancelled agent neither
   * succeeded nor failed, and counting cancellations as failures makes a
   * user's own stop button look like a defect in the platform.
   */
  outcome: 'completed' | 'degraded' | 'failed' | 'cancelled';
  /** Omitted when the start of this agent's turn was not observed. */
  durationMs?: number | undefined;
  reason?: string | undefined;
}

/**
 * An attempt being retried.
 *
 * Distinct from the `retries` count on a finished `model.call`: that says how
 * many attempts a call ended up needing, which is only knowable afterwards.
 * This says one is happening now and why, which is what makes a run that is
 * quietly burning its retry budget visible while it is still running.
 */
export interface RetryEvent {
  event: 'retry';
  /** What is being retried — an agent id, a provider operation, a stage. */
  target: string;
  /** 1-based attempt number about to be made. */
  attempt: number;
  /** The classification that caused the retry, never the error payload. */
  reason?: string | undefined;
}

/**
 * Validation beginning.
 *
 * The existing `validation` event is the result; this is its opening half,
 * so a validation that never returned is visible as a start with no end
 * rather than as nothing at all.
 */
export interface ValidationStartEvent {
  event: 'validation.start';
  target: string;
}

/**
 * One repair attempt, with what it actually achieved.
 *
 * `remaining` is the point of the event: "attempt 2 of 3 ran" says nothing
 * about whether the loop is converging, and a repair loop that burns its
 * budget without reducing the issue count is the failure worth seeing.
 */
export interface RepairAttemptEvent {
  event: 'repair.attempt';
  /** 1-based, within this run's repair budget. */
  attempt: number;
  /** What was being repaired — a file path, a check name. */
  target: string;
  outcome: 'fixed' | 'unchanged' | 'failed';
  durationMs: number;
  /** Issues still outstanding after the attempt, when countable. */
  remaining?: number | undefined;
  reason?: string | undefined;
}

/**
 * A background job changing state.
 *
 * The edit-job row already records this durably; the event exists so the
 * transition appears in the same timeline as the model calls and processes
 * that caused it, which is what makes "why did this edit roll back" one
 * question instead of three.
 */
export interface JobTransitionEvent {
  event: 'job.transition';
  jobId: string;
  /** Previous and next status, as the store names them. */
  from: string;
  to: string;
  /** The job's stage when it moved. */
  stage?: string | undefined;
  /** Time in the previous state, when the store knows it. */
  durationMs?: number | undefined;
  reason?: string | undefined;
}

/**
 * Work being undone.
 *
 * Separate from `cleanup`, which releases something the platform owns: a
 * rollback puts a user's project back the way it was, and conflating the two
 * loses the only line that explains why their edit did not take effect.
 */
export interface RollbackEvent {
  event: 'rollback';
  /** What was restored — a project's files, a workspace, a run's artifacts. */
  target: string;
  outcome: 'restored' | 'failed';
  /** Why the rollback happened. A reason, never a diff. */
  reason: string;
  durationMs?: number | undefined;
}

/**
 * A child process starting.
 *
 * The matching `process.exit` carries the duration; this one carries the pid,
 * which is what ties a log line to a process still running on the machine —
 * the question asked when a port is held and nothing owns it.
 */
export interface ProcessStartEvent {
  event: 'process.start';
  command: string;
  /** Null when the spawn produced no pid at all. */
  pid: number | null;
}

export type OperationalEvent =
  | RunStartEvent
  | RunEndEvent
  | StageStartEvent
  | StageEndEvent
  | AgentStartEvent
  | AgentEndEvent
  | RetryEvent
  | ValidationStartEvent
  | ModelCallEvent
  | RepairAttemptEvent
  | ValidationEvent
  | JobTransitionEvent
  | RollbackEvent
  | ProcessStartEvent
  | ProcessExitEvent
  | CleanupEvent;

/**
 * Starts a duration measurement.
 *
 * `performance.now()` rather than `Date.now()` because a duration taken
 * across a wall-clock adjustment (NTP, a laptop waking up) is otherwise
 * free to come out negative, and a long stage is exactly when that happens.
 */
export function startTimer(): () => number {
  const startedAt = performance.now();
  return () => Math.round(performance.now() - startedAt);
}

/** The human half of the line: enough to read the log without a parser. */
function describe(event: OperationalEvent): { failed: boolean; subject: string } {
  switch (event.event) {
    case 'run.start':
      return { failed: false, subject: `${event.trigger} ${String(event.stages)} stages` };
    case 'run.end':
      return { failed: event.outcome === 'failed', subject: `run ${event.outcome}` };
    case 'stage.start':
      return { failed: false, subject: event.stage };
    case 'stage.end':
      return { failed: event.outcome === 'failed', subject: `${event.stage} ${event.outcome}` };
    case 'agent.start':
      return { failed: false, subject: event.agentId };
    case 'agent.end':
      return { failed: event.outcome === 'failed', subject: `${event.agentId} ${event.outcome}` };
    case 'retry':
      return {
        failed: false,
        subject: `${event.target} attempt ${String(event.attempt)}`,
      };
    case 'validation.start':
      return { failed: false, subject: event.target };
    case 'model.call':
      return {
        failed: event.outcome === 'failed',
        subject: `${event.provider}/${event.model} ${event.outcome}`,
      };
    case 'repair.attempt':
      return {
        failed: event.outcome === 'failed',
        subject: `attempt ${String(event.attempt)} ${event.target} ${event.outcome}`,
      };
    case 'validation':
      return { failed: event.outcome === 'failed', subject: `${event.target} ${event.outcome}` };
    case 'job.transition':
      return {
        failed: event.to === 'FAILED',
        subject: `${event.jobId} ${event.from}->${event.to}`,
      };
    case 'rollback':
      return { failed: event.outcome === 'failed', subject: `${event.target} ${event.outcome}` };
    case 'process.start':
      return { failed: false, subject: `${event.command} pid=${String(event.pid ?? 'none')}` };
    case 'process.exit':
      return {
        failed: event.exitCode !== 0,
        subject: `${event.command} exit=${event.exitCode ?? event.signal ?? 'unknown'}`,
      };
    case 'cleanup':
      return { failed: event.outcome === 'failed', subject: `${event.target} ${event.outcome}` };
  }
}

/**
 * The fields that actually ship.
 *
 * Exported because the timeline keeps its own copy of each event and has to
 * keep it in the same shape: storing the raw event there meant the `tokens`
 * key reached the redactor, which masks any key whose name contains
 * "token", so the timeline API served "***" where the log line published
 * the real figures.
 *
 * A token count only ships when the provider reported one. `ModelUsage`
 * has no "was this reported" flag and the orchestrator fills a failed call
 * with `{ inputTokens: 0, outputTokens: 0 }` as a placeholder, so an
 * all-zero usage is dropped rather than published: logging it would turn a
 * missing measurement into a measured zero, and no real call bills zero
 * input tokens.
 */
export function wirePayload(event: OperationalEvent): Record<string, unknown> {
  const fields: Record<string, unknown> = { ...event };
  if (event.event !== 'model.call') return fields;

  const tokens = event.tokens;
  delete fields.tokens;
  if (tokens === undefined || (tokens.inputTokens === 0 && tokens.outputTokens === 0))
    return fields;

  const usage: WireUsage = { input: tokens.inputTokens, output: tokens.outputTokens };
  fields.usage = usage;
  return fields;
}

/**
 * Emits one operational event.
 *
 * Failures go to `warn` and everything else to `info`, so the default
 * production level shows both — an operator reading the log at `info` sees
 * the whole timeline, not just the half that worked.
 */
export function logEvent(event: OperationalEvent): void {
  const { failed, subject } = describe(event);
  const payload = { op: true, ...wirePayload(event) };
  const message = `op ${event.event} ${subject}`;
  if (failed) logger.warn(message, payload);
  else logger.info(message, payload);

  // The in-memory timeline is fed from here rather than from the call sites,
  // so there is exactly one list of what was emitted and no way for a new
  // event kind to reach the log but miss the timeline.
  recordTimelineEvent(event);
}
