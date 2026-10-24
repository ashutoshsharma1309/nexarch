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
  issues: number;
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

export type OperationalEvent =
  | StageStartEvent
  | StageEndEvent
  | ModelCallEvent
  | ValidationEvent
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
    case 'stage.start':
      return { failed: false, subject: event.stage };
    case 'stage.end':
      return { failed: event.outcome === 'failed', subject: `${event.stage} ${event.outcome}` };
    case 'model.call':
      return {
        failed: event.outcome === 'failed',
        subject: `${event.provider}/${event.model} ${event.outcome}`,
      };
    case 'validation':
      return { failed: event.outcome === 'failed', subject: `${event.target} ${event.outcome}` };
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
 * A token count only ships when the provider reported one. `ModelUsage`
 * has no "was this reported" flag and the orchestrator fills a failed call
 * with `{ inputTokens: 0, outputTokens: 0 }` as a placeholder, so an
 * all-zero usage is dropped rather than published: logging it would turn a
 * missing measurement into a measured zero, and no real call bills zero
 * input tokens.
 */
function payloadOf(event: OperationalEvent): Record<string, unknown> {
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
  const payload = { op: true, ...payloadOf(event) };
  const message = `op ${event.event} ${subject}`;
  if (failed) logger.warn(message, payload);
  else logger.info(message, payload);
}
