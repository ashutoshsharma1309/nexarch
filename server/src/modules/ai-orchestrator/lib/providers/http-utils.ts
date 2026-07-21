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

  constructor(kind: RetryableErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'ProviderCallError';
    this.kind = kind;
    this.status = status;
  }
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
    throw new ProviderCallError('rate-limit', `${url} responded 429 rate limited`, 429);
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
