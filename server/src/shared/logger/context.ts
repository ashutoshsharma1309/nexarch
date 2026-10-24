/**
 * Ambient log context — the ids every log line should carry.
 *
 * The hard case on this platform is not the request; it is the work the
 * request starts. `startRun` answers the HTTP call and leaves
 * `void execute(...)` running for minutes, so every line the pipeline,
 * agent and runner code emits afterwards lands in the log with nothing
 * tying it back to the caller. That is why "the build failed for that
 * user" was not answerable from the logs.
 *
 * `AsyncLocalStorage` (node:async_hooks — built in, no dependency) carries
 * the ids down the async chain instead of through a parameter on forty
 * functions. A promise detached inside the context keeps that context for
 * its whole life, so background work inherits the request id with no
 * change at the call site that detaches it.
 *
 * Nothing here is a security boundary: the store holds ids, it is not a
 * place to keep a token or a prompt.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export interface LogContext {
  /** The correlation id echoed as `X-Request-Id` and in the error envelope. */
  requestId?: string | undefined;
  /** The acting user's id — never their email or any other PII. */
  userId?: string | undefined;
  projectId?: string | undefined;
  runId?: string | undefined;
}

const storage = new AsyncLocalStorage<LogContext>();

/** Runs `fn` under a fresh context — the entry point, one call per request. */
export function runWithLogContext<T>(context: LogContext, fn: () => T): T {
  return storage.run({ ...context }, fn);
}

/**
 * Runs `fn` under the current context plus `patch`, in a store of its own.
 *
 * A stage that adds its own `runId` must not write it into the context its
 * siblings are reading, which is why this forks rather than mutates.
 */
export function withLogContext<T>(patch: LogContext, fn: () => T): T {
  return storage.run({ ...storage.getStore(), ...patch }, fn);
}

/**
 * Adds to the context already in effect.
 *
 * For facts the request learns about itself after the context was opened —
 * the authenticated user id is the case: auth runs several middlewares
 * after correlation. No-ops outside a context rather than opening one,
 * because a context that ends when the caller's function returns would
 * silently cover nothing.
 */
export function setLogContext(patch: LogContext): void {
  const store = storage.getStore();
  if (store === undefined) return;
  Object.assign(store, patch);
}

/** The context in effect, or undefined outside one (a startup or cron path). */
export function currentLogContext(): Readonly<LogContext> | undefined {
  return storage.getStore();
}

/** The correlation id in effect, for callers that need it as a value. */
export function currentRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}
