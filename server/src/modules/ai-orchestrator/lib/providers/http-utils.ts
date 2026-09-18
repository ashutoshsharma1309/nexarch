/**
 * Shared HTTP call + error classification for every real provider adapter
 * (Claude, OpenAI, Gemini, OpenRouter) — one place that knows how to turn a
 * failed `fetch` into a `RetryableErrorKind`, so the retry manager can
 * decide what to do without each adapter re-implementing the same
 * try/catch/classify logic.
 */
import type { RetryableErrorKind } from '../../ai-orchestrator.types.js';

export class ProviderCallError extends Error {
  readonly kind: RetryableErrorKind;
  readonly status: number | undefined;
  /** How long the provider asked us to wait before retrying, when it said. */
  readonly retryAfterMs: number | undefined;

  constructor(kind: RetryableErrorKind, message: string, status?: number, retryAfterMs?: number) {
    super(message);
    this.name = 'ProviderCallError';
    this.kind = kind;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

/** `"7.66s"`, `"1m2.5s"`, `"250ms"` → milliseconds (Groq's x-ratelimit-reset-* format). */
function durationMs(value: string): number | undefined {
  const match = /^(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?(?:(\d+)ms)?$/.exec(value.trim());
  if (!match || value.trim() === '') return undefined;
  const [, minutes, seconds, millis] = match;
  return (Number(minutes ?? 0) * 60 + Number(seconds ?? 0)) * 1_000 + Number(millis ?? 0);
}

/**
 * The provider's own answer to "when can I retry?". `retry-after` is seconds
 * or an HTTP date; Groq also sends `x-ratelimit-reset-tokens` /
 * `-requests` as durations. Without this, a per-minute limit was retried
 * three times inside a second and the stage fell back to built-in rules.
 */
export function retryAfterOf(headers: Headers): number | undefined {
  const header = headers.get('retry-after');
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
    const date = Date.parse(header);
    if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  }
  const resets = ['x-ratelimit-reset-tokens', 'x-ratelimit-reset-requests']
    .map((name) => headers.get(name))
    .filter((value): value is string => value !== null)
    .map(durationMs)
    .filter((value): value is number => value !== undefined);
  return resets.length > 0 ? Math.max(...resets) : undefined;
}

const TIMEOUT_MS = 60_000;

export async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ProviderCallError('timeout', `Request to ${url} timed out after ${TIMEOUT_MS}ms`);
    }
    throw new ProviderCallError('network', error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 429) {
    throw new ProviderCallError(
      'rate-limit',
      `${url} responded 429 rate limited`,
      429,
      retryAfterOf(response.headers),
    );
  }
  if (!response.ok) {
    const kind: RetryableErrorKind = response.status >= 500 ? 'network' : 'unknown';
    const text = await response.text().catch(() => '');
    throw new ProviderCallError(
      kind,
      `${url} responded ${response.status}: ${text.slice(0, 500)}`,
      response.status,
    );
  }

  try {
    return await response.json();
  } catch (error) {
    throw new ProviderCallError(
      'invalid-json',
      `${url} returned a non-JSON body: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
