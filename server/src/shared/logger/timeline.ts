/**
 * The execution timeline — operational events, grouped and still in memory.
 *
 * The events themselves already go to the log, where they are durable and
 * greppable. That is the right place for them and the wrong place to *read*
 * them from: answering "which stage took longest" from a log file means
 * knowing the request id before you start, having the file, and writing a
 * parser. Every one of those is a reason the question does not get asked.
 *
 * So the same events are also kept here, grouped by the correlation id they
 * already carry, with a derived summary over each group. Nothing is written
 * to the database: these are high-frequency lines whose value expires in
 * minutes, and a row per model call would cost more than the answer is
 * worth. The price of that choice is honest and stated in the API — a
 * timeline is gone after a restart, and the log is still the durable record.
 *
 * Both dimensions are bounded, because an unbounded diagnostic buffer is
 * just a slower memory leak: at most `MAX_TIMELINES` correlations, each with
 * at most `MAX_ENTRIES` events, evicted oldest-first exactly the way the
 * pipeline's own run store does it.
 */
import { redactValue } from '../security/redact.js';
import { currentLogContext } from './context.js';
import type { LogContext } from './context.js';
import { wirePayload } from './events.js';
import type { OperationalEvent } from './events.js';

/** How many correlations to keep. Oldest evicted first. */
const MAX_TIMELINES = 50;

/**
 * How many events one correlation may hold.
 *
 * A full generation emits a few dozen; a run that retries hard emits more.
 * This is set well above the honest worst case and exists only so a runaway
 * emitter cannot grow the process without limit.
 */
const MAX_ENTRIES = 500;

export interface TimelineEntry {
  /** Wall-clock, for reading the line. Durations come from the events. */
  at: string;
  event: OperationalEvent;
}

/**
 * What the timeline answers without the reader doing arithmetic.
 *
 * Every field is derived from events that were actually emitted. A question
 * nothing measured is reported as null rather than zero: "no validation
 * event was seen" and "validation took 0ms" are different facts, and the
 * zero is the one that misleads.
 */
export interface TimelineSummary {
  /** The stage with the longest measured duration, if any stage ended. */
  slowestStage: { stage: string; durationMs: number } | null;
  totalStageMs: number | null;
  /** Agents that ended badly, in the order they failed. */
  failedAgents: string[];
  degradedAgents: string[];
  /** Retry events seen — attempts actually made, not an afterwards estimate. */
  retries: number;
  modelCalls: number;
  cachedModelCalls: number;
  failedModelCalls: number;
  /** Retries the model-call events reported. Null when none reported any. */
  modelRetries: number | null;
  /** Summed cost of priced calls. Null when nothing priced was seen. */
  costUsd: number | null;
  validationMs: number | null;
  validationsPassed: number;
  validationsFailed: number;
  repairAttempts: number;
  repairsFixed: number;
  rollbacks: number;
  /** Processes that exited non-zero or on a signal. */
  unexpectedProcessExits: number;
  /** The reason carried by the first failing event — usually the real cause. */
  firstFailureReason: string | null;
}

export interface Timeline {
  /** The correlation this timeline belongs to: a run id, or a request id. */
  key: string;
  startedAt: string;
  updatedAt: string;
  entries: TimelineEntry[];
  /** True when events were dropped because the entry cap was reached. */
  truncated: boolean;
  summary: TimelineSummary;
}

interface Bucket {
  key: string;
  /**
   * Who the work belonged to, from the ambient context.
   *
   * Recorded so a timeline can be served to its owner and nobody else. A
   * timeline carries no prompts and no generated files, but it does carry
   * another user's run ids and timings, and "operational data" is not a
   * reason to hand those across accounts. Null means no user was in
   * context, and an unowned timeline is served to no one.
   */
  ownerId: string | null;
  /** The project the work belonged to, when the context named one. */
  projectId: string | null;
  startedAt: string;
  updatedAt: string;
  entries: TimelineEntry[];
  truncated: boolean;
}

const buckets = new Map<string, Bucket>();

/**
 * Keys that were evicted, so a correlation that comes back can admit it lost
 * events. Bounded, and the oldest are forgotten first — forgetting one only
 * costs the `truncated` flag on a timeline that has since been evicted twice.
 */
const evicted = new Set<string>();
const MAX_REMEMBERED_EVICTIONS = 200;

/**
 * Drops the least recently updated timelines until the buffer fits.
 *
 * Least-recently-*updated*, not first-inserted: a pipeline run is created by
 * its first event and then updated for minutes, so insertion order evicted
 * exactly the long-running timelines most worth keeping while idle finished
 * ones survived.
 */
function evictOldest(): void {
  while (buckets.size > MAX_TIMELINES) {
    let oldestKey: string | null = null;
    let oldestAt = '';
    for (const [key, bucket] of buckets) {
      if (oldestKey === null || bucket.updatedAt < oldestAt) {
        oldestKey = key;
        oldestAt = bucket.updatedAt;
      }
    }
    if (oldestKey === null) return;
    buckets.delete(oldestKey);
    evicted.add(oldestKey);
    while (evicted.size > MAX_REMEMBERED_EVICTIONS) {
      const forget = evicted.values().next().value;
      if (forget === undefined) break;
      evicted.delete(forget);
    }
  }
}

/**
 * Which correlation an event belongs to.
 *
 * The run id is preferred when one is in context: a generation is the unit a
 * reader thinks in, and it outlives the request that started it. The request
 * id is the fallback so events emitted before a run exists — or by work with
 * no run at all, like a preview session — are still grouped rather than
 * dropped.
 */
function correlationKey(): string | null {
  const context = currentLogContext();
  const correlation = correlationIdOf(context);
  if (correlation === null) return null;
  // The bucket key includes the owner.
  //
  // The correlation can be partly client-chosen: a request may supply its
  // own `X-Request-Id`, and a plain request with no run, job or session
  // groups under it. Keying on the correlation alone meant two accounts
  // sending the same header shared a bucket, and whichever created it owned
  // — and could then read — the other's events. Owner-first keying makes
  // that impossible rather than merely unlikely.
  return `${context?.userId ?? 'anonymous'}\u0000${correlation}`;
}

function correlationIdOf(context: Readonly<LogContext> | undefined): string | null {
  // Most specific first. A run is the unit a reader thinks in; an edit job
  // and a preview session are units that have no run id while they are the
  // thing going wrong. The request id is the fallback so work with none of
  // the three is still grouped rather than dropped.
  return context?.runId ?? context?.jobId ?? context?.sessionId ?? context?.requestId ?? null;
}

/**
 * Files one event under its correlation.
 *
 * Named for the timeline rather than called `recordEvent`, because the agent
 * orchestrator already exports a `recordEvent` for its own per-run event
 * stream and two functions with one name in one codebase is how a call site
 * ends up writing to the wrong one.
 *
 * Called from `logEvent`, so it must never throw and never cost anything
 * worth noticing: a diagnostic that can break the thing it observes is worse
 * than no diagnostic.
 */
export function recordTimelineEvent(event: OperationalEvent): void {
  const key = correlationKey();
  // Outside any context there is nothing to group by. Startup paths and
  // scripts land here, and the log line has already been written.
  if (key === null) return;

  const at = new Date().toISOString();
  let bucket = buckets.get(key);
  if (!bucket) {
    const context = currentLogContext();
    bucket = {
      key,
      ownerId: context?.userId ?? null,
      projectId: context?.projectId ?? null,
      startedAt: at,
      updatedAt: at,
      entries: [],
      // A correlation that was evicted and has come back is, by definition,
      // missing its earlier events. Saying so is the whole point: a long run
      // whose bucket was dropped mid-flight used to reappear with a fresh
      // start time and `truncated: false`, so a half-missing timeline
      // asserted it was complete and its "slowest stage" was whichever
      // stage happened to survive.
      truncated: evicted.has(key),
    };
    buckets.set(key, bucket);
    evictOldest();
  }

  bucket.updatedAt = at;
  if (bucket.entries.length >= MAX_ENTRIES) {
    bucket.truncated = true;
    return;
  }
  // Redacted on the way in, not on the way out.
  //
  // This is not belt-and-braces: the log line is redacted by the logger's
  // format chain, which runs on the way to the transports and never touches
  // this copy. Several event kinds build their `reason` from an error
  // message — a failing stage, a failed validation, a settled job — and a
  // Prisma connection error carries the credential URL in its text. Without
  // this, the log file masked the password and the timeline API served it.
  // Redacting once here keeps the two consistent by construction.
  bucket.entries.push({ at, event: redactEvent(event) });
}

/**
 * An event with its values masked, same rules as every log line.
 *
 * `redactValue` masks by value shape (credential URLs, provider keys,
 * bearers, JWTs) and by key name, and preserves the structure of a plain
 * object — which every operational event is by construction, since the union
 * admits only strings, numbers, nulls and the one `tokens` object. The cast
 * therefore describes what comes back rather than asserting something the
 * redactor does not guarantee.
 */
function redactEvent(event: OperationalEvent): OperationalEvent {
  // `wirePayload` first, for the same reason the log line uses it: it renames
  // `tokens` to `usage`, and the redactor masks any key whose name contains
  // "token" because it cannot tell a bearer from a count. Without this the
  // log published the real figures and this copy served "***".
  return redactValue(wirePayload(event), 0, 6) as OperationalEvent;
}

/** The reason an event carries, when it carries one. */
function reasonOf(event: OperationalEvent): string | null {
  if ('reason' in event && typeof event.reason === 'string' && event.reason !== '') {
    return event.reason;
  }
  return null;
}

/** Whether an event represents something going wrong. */
function isFailure(event: OperationalEvent): boolean {
  switch (event.event) {
    case 'run.end':
    case 'agent.end':
      return event.outcome === 'failed';
    case 'stage.end':
      return event.outcome === 'failed';
    case 'model.call':
    case 'repair.attempt':
      return event.outcome === 'failed';
    case 'validation':
      return event.outcome === 'failed';
    case 'rollback':
      return event.outcome === 'failed';
    case 'process.exit':
      return event.exitCode !== 0;
    case 'job.transition':
      return event.to === 'FAILED';
    default:
      return false;
  }
}

export function summarize(entries: readonly TimelineEntry[]): TimelineSummary {
  let slowestStage: { stage: string; durationMs: number } | null = null;
  let totalStageMs: number | null = null;
  const failedAgents: string[] = [];
  const degradedAgents: string[] = [];
  let retries = 0;
  let modelCalls = 0;
  let cachedModelCalls = 0;
  let failedModelCalls = 0;
  let modelRetries: number | null = null;
  let costUsd: number | null = null;
  let validationMs: number | null = null;
  let validationsPassed = 0;
  let validationsFailed = 0;
  let repairAttempts = 0;
  let repairsFixed = 0;
  let rollbacks = 0;
  let unexpectedProcessExits = 0;
  let firstFailureReason: string | null = null;

  for (const { event } of entries) {
    if (firstFailureReason === null && isFailure(event)) {
      firstFailureReason = reasonOf(event);
    }

    switch (event.event) {
      case 'stage.end': {
        totalStageMs = (totalStageMs ?? 0) + event.durationMs;
        if (slowestStage === null || event.durationMs > slowestStage.durationMs) {
          slowestStage = { stage: event.stage, durationMs: event.durationMs };
        }
        break;
      }
      case 'agent.end': {
        if (event.outcome === 'failed') failedAgents.push(event.agentId);
        if (event.outcome === 'degraded') degradedAgents.push(event.agentId);
        break;
      }
      case 'retry': {
        retries += 1;
        break;
      }
      case 'model.call': {
        modelCalls += 1;
        if (event.outcome === 'cached') cachedModelCalls += 1;
        if (event.outcome === 'failed') failedModelCalls += 1;
        // Counted only where the call site reported a figure, so an
        // un-counted retry cannot read as zero retries.
        if (event.retries !== undefined) modelRetries = (modelRetries ?? 0) + event.retries;
        if (typeof event.costUsd === 'number') costUsd = (costUsd ?? 0) + event.costUsd;
        break;
      }
      case 'validation': {
        if (event.outcome === 'passed') validationsPassed += 1;
        else validationsFailed += 1;
        if (event.durationMs !== undefined) validationMs = (validationMs ?? 0) + event.durationMs;
        break;
      }
      case 'repair.attempt': {
        repairAttempts += 1;
        if (event.outcome === 'fixed') repairsFixed += 1;
        break;
      }
      case 'rollback': {
        rollbacks += 1;
        break;
      }
      case 'process.exit': {
        if (event.exitCode !== 0) unexpectedProcessExits += 1;
        break;
      }
      default:
        break;
    }
  }

  return {
    slowestStage,
    totalStageMs,
    failedAgents,
    degradedAgents,
    retries,
    modelCalls,
    cachedModelCalls,
    failedModelCalls,
    modelRetries,
    costUsd: costUsd === null ? null : Math.round(costUsd * 1e6) / 1e6,
    validationMs,
    validationsPassed,
    validationsFailed,
    repairAttempts,
    repairsFixed,
    rollbacks,
    unexpectedProcessExits,
    firstFailureReason,
  };
}

/** The correlation id, without the owner the bucket key is prefixed with. */
function correlationOf(bucket: Bucket): string {
  const separator = bucket.key.indexOf('\u0000');
  return separator === -1 ? bucket.key : bucket.key.slice(separator + 1);
}

function present(bucket: Bucket): Timeline {
  return {
    key: correlationOf(bucket),
    startedAt: bucket.startedAt,
    updatedAt: bucket.updatedAt,
    entries: [...bucket.entries],
    truncated: bucket.truncated,
    summary: summarize(bucket.entries),
  };
}

/**
 * One correlation's timeline, or null.
 *
 * Null covers "never recorded", "evicted" and "not yours" alike — the same
 * answer the rest of this API gives for a resource another account owns, so
 * a key that exists is not distinguishable from one that does not.
 */
export function getTimeline(correlation: string, ownerId: string): Timeline | null {
  // Looked up under the asking owner's prefix, so a correlation another
  // account recorded is not merely refused — it is not even addressable.
  const bucket = buckets.get(`${ownerId}\u0000${correlation}`);
  if (bucket?.ownerId !== ownerId) return null;
  return present(bucket);
}

/**
 * Every timeline held, newest activity first.
 *
 * Summaries only would be cheaper, but the caller that lists is the caller
 * that then asks for one, and the whole buffer is bounded at a few thousand
 * small objects — small enough that a second lookup costs more than the copy.
 */
export function listTimelines(ownerId: string, projectId?: string): Timeline[] {
  return (
    [...buckets.values()]
      .filter((bucket) => bucket.ownerId === ownerId)
      // Filtered here rather than by the caller: an edit job and a preview
      // session are keyed by their own ids, so a client holding only a list of
      // run ids cannot tell which timelines belong to the project it is
      // showing. The context knew, so the bucket remembers.
      .filter((bucket) => projectId === undefined || bucket.projectId === projectId)
      .map(present)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  );
}

/** Drops everything. For tests, which must not inherit each other's events. */
export function clearTimelines(): void {
  buckets.clear();
  evicted.clear();
}
