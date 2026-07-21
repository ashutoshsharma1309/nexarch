/**
 * Retries a failing call with exponential backoff, classifying the error
 * kind first (network, timeout, invalid JSON, malformed response, rate
 * limit) so the caller's history record can say *why* a call needed a
 * retry, not just that it did.
 */
import type { RetryableErrorKind, RetryAttempt } from '../ai-orchestrator.types.js';
import { ProviderCallError } from './providers/http-utils.js';

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export interface RetryOutcome<T> {
  result: T;
  attempts: RetryAttempt[];
}

export class NonRetryableError extends Error {}

function classify(error: unknown): { kind: RetryableErrorKind; message: string } {
  if (error instanceof ProviderCallError) return { kind: error.kind, message: error.message };
  if (error instanceof SyntaxError) return { kind: 'invalid-json', message: error.message };
  const message = error instanceof Error ? error.message : String(error);
  return { kind: 'unknown', message };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 300;
const DEFAULT_MAX_DELAY_MS = 8_000;

/** All classified error kinds are retryable — per spec, network/timeout/invalid-json/malformed/rate-limit all get an automatic retry. Only a `NonRetryableError` the caller throws deliberately skips the loop. */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<RetryOutcome<T>> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const attempts: RetryAttempt[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await fn(attempt);
      return { result, attempts };
    } catch (error) {
      if (error instanceof NonRetryableError) throw error;

      const { kind, message } = classify(error);
      const isLastAttempt = attempt === maxAttempts;
      const backoffDelay = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));

      attempts.push({
        attempt,
        errorKind: kind,
        message,
        delayMs: isLastAttempt ? 0 : backoffDelay,
      });

      if (isLastAttempt) throw error;
      await delay(backoffDelay);
    }
  }

  throw new Error('unreachable');
}
