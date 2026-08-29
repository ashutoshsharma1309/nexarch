/**
 * Runs one agent, once, with the guarantees the orchestrator promises.
 *
 * Four of them, and each exists because its absence is a specific failure
 * mode this platform has to avoid:
 *
 *   • a **timeout**, so a task cannot sit in RUNNING forever waiting on a
 *     provider that will never answer;
 *   • **classified retries**, so a transient network error gets a second
 *     chance and a malformed schema does not get three identical ones;
 *   • **output validation** before anything is accepted, so a model's bad
 *     day cannot enter project state; and
 *   • **failure isolation** — a thrown agent produces a FAILED task, never
 *     a corrupted run.
 *
 * The executor knows nothing about which agent it is running. Everything
 * specific comes from the definition.
 */
import { logger } from '../../../shared/logger/index.js';
import { getAgent } from './registry.js';
import { recordEvent } from './run-store.js';
import type {
  AgentDefinition,
  AgentExecutionInput,
  AgentFailureKind,
  AgentResult,
} from '../../../shared/contracts/index.js';

/** Thrown by an agent to say *why* it failed, so retry can be decided. */
export class AgentError extends Error {
  readonly kind: AgentFailureKind;

  constructor(kind: AgentFailureKind, message: string) {
    super(message);
    this.name = 'AgentError';
    this.kind = kind;
  }
}

/**
 * Best-effort classification for errors that arrive without a kind.
 *
 * Deliberately conservative: anything unrecognised is `internal`, which is
 * *not* retryable. Guessing that an unknown failure is transient is how a
 * deterministic bug becomes three identical model calls.
 */
export function classify(error: unknown): AgentFailureKind {
  if (error instanceof AgentError) return error.kind;
  const message = error instanceof Error ? error.message : String(error);

  if (/abort|cancel/i.test(message)) return 'cancelled';
  if (/timed out|timeout|ETIMEDOUT/i.test(message)) return 'timeout';
  if (/429|rate limit/i.test(message)) return 'rate-limit';
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|network|socket/i.test(message)) return 'network';
  if (/401|403|invalid api key|unauthor/i.test(message)) return 'unauthorized';
  if (/schema|malformed|not valid JSON|validation/i.test(message)) return 'invalid-output';
  if (/5\d\d\b|provider/i.test(message)) return 'provider-error';
  return 'internal';
}

/** Plain-language failure text. Provider internals stay in the log. */
export function userFacing(kind: AgentFailureKind, message: string): string {
  switch (kind) {
    case 'timeout':
      return 'The agent did not finish within its time limit';
    case 'rate-limit':
      return 'The AI provider is rate limiting this key';
    case 'network':
      return 'The AI provider could not be reached';
    case 'unauthorized':
      return 'The configured AI key was rejected';
    case 'invalid-output':
      return 'The agent returned output that failed validation';
    case 'invalid-input':
      return 'The agent was given inputs it could not use';
    case 'cancelled':
      return 'The run was cancelled';
    case 'validation-failed':
      return message;
    default:
      return 'An unexpected error interrupted this agent';
  }
}

/** Races the agent against its own deadline. */
async function withTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
  onTimeout: () => void,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      onTimeout();
      reject(new AgentError('timeout', `Agent exceeded ${String(timeoutMs)}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([work, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Structural validation of what an agent returned.
 *
 * Not a schema check of the artifact's contents — each agent validates its
 * own domain output. This is the contract check: did it produce what it
 * declared it produces, and is it non-empty? An agent that returns
 * `succeeded` with no artifact has failed and not noticed.
 */
export function validateResult(
  definition: AgentDefinition,
  result: AgentResult,
): { valid: boolean; reason: string | null } {
  if (result.status !== 'succeeded') {
    return { valid: false, reason: result.error ?? 'Agent did not succeed' };
  }

  for (const type of definition.produces) {
    const value = result.artifacts[type];
    if (value === undefined || value === null) {
      return { valid: false, reason: `Agent declared it produces "${type}" but returned none` };
    }
  }

  // An agent may only emit what it declared. This is the isolation boundary:
  // a database agent quietly returning frontend source is a bug, and one
  // that would otherwise enter project state unnoticed.
  const declared = new Set<string>([...definition.produces, ...(definition.revises ?? [])]);
  const undeclared = Object.keys(result.artifacts).filter((type) => !declared.has(type));
  if (undeclared.length > 0) {
    return {
      valid: false,
      reason: `Agent produced artifacts outside its declared scope: ${undeclared.join(', ')}`,
    };
  }

  return { valid: true, reason: null };
}

export interface ExecutionOutcome {
  result: AgentResult;
  attempts: number;
}

/**
 * Executes an agent with retries, and reports what happened either way.
 *
 * A rejected promise never escapes: the caller receives a failed
 * `AgentResult` instead, because one agent's failure must leave the run's
 * other artifacts intact.
 */
export async function executeAgent(
  definition: AgentDefinition,
  input: AgentExecutionInput,
): Promise<ExecutionOutcome> {
  const agent = getAgent(definition.id);
  const policy = definition.retryPolicy;
  let attempt = 0;
  let lastKind: AgentFailureKind = 'internal';
  let lastMessage = 'Agent did not run';

  while (attempt <= policy.maxRetries) {
    if (input.signal.aborted) {
      return {
        result: failed(definition, 'cancelled', 'The run was cancelled', 0),
        attempts: attempt,
      };
    }

    const startedAt = Date.now();
    // Each attempt gets its own abort controller so a timeout can stop the
    // work in flight, while still respecting the run-level cancellation.
    const attemptController = new AbortController();
    const onRunAbort = (): void => {
      attemptController.abort();
    };
    input.signal.addEventListener('abort', onRunAbort, { once: true });

    try {
      const result = await withTimeout(
        agent.execute({ ...input, signal: attemptController.signal }),
        definition.timeoutMs,
        () => {
          attemptController.abort();
        },
      );

      const validation = validateResult(definition, result);
      if (!validation.valid) {
        throw new AgentError(
          'invalid-output',
          validation.reason ?? 'Agent output failed validation',
        );
      }

      return { result: { ...result, durationMs: Date.now() - startedAt }, attempts: attempt + 1 };
    } catch (error) {
      lastKind = classify(error);
      lastMessage = error instanceof Error ? error.message : String(error);

      const retryable = policy.retryableKinds.includes(lastKind);
      const hasBudget = attempt < policy.maxRetries;

      logger.warn('agent attempt failed', {
        agentId: definition.id,
        taskId: input.taskId,
        attempt: attempt + 1,
        kind: lastKind,
        retryable: retryable && hasBudget,
      });

      if (!retryable || !hasBudget || lastKind === 'cancelled') {
        return {
          result: failed(
            definition,
            lastKind,
            userFacing(lastKind, lastMessage),
            Date.now() - startedAt,
          ),
          attempts: attempt + 1,
        };
      }

      recordEvent(input.runId, 'AGENT_RETRY', {
        taskId: input.taskId,
        agentId: definition.id,
        detail: { attempt: attempt + 1, kind: lastKind },
      });

      // Exponential backoff, and still interruptible by cancellation.
      await sleep(policy.backoffMs * Math.pow(2, attempt), input.signal);
      attempt += 1;
    } finally {
      input.signal.removeEventListener('abort', onRunAbort);
    }
  }

  return {
    result: failed(definition, lastKind, userFacing(lastKind, lastMessage), 0),
    attempts: attempt + 1,
  };
}

function failed(
  definition: AgentDefinition,
  kind: AgentFailureKind,
  message: string,
  durationMs: number,
): AgentResult {
  return {
    agentId: definition.id,
    status: 'failed',
    output: null,
    artifacts: {},
    findings: [],
    error: message,
    failureKind: kind,
    durationMs,
    usage: null,
  };
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
