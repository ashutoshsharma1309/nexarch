/**
 * The Brave and Tavily HTTP clients.
 *
 * Brave only discovers: it returns links and a short description. Tavily can
 * also read a page through /extract. A search result is not page content, and
 * callers rely on that distinction to report what was really read.
 *
 * Errors carry a status and never a response body or request header, because
 * they end up in artifact limitations.
 */
import { z } from 'zod';

import type { ResearchProviderId } from '../web-research.types.js';

const BRAVE_URL = 'https://api.search.brave.com/res/v1/web/search';
const TAVILY_SEARCH_URL = 'https://api.tavily.com/search';
const TAVILY_EXTRACT_URL = 'https://api.tavily.com/extract';

/** Raw page text kept before sanitising: well above what any excerpt can use. */
const MAX_RAW_PAGE_CHARS = 40_000;
const MAX_RAW_SNIPPET_CHARS = 2_000;

/** Bad key, no credit or rate limited: another request this run would fail the same way. */
const STOP_USING_PROVIDER = new Set([401, 402, 403, 429]);

export type FetchLike = typeof fetch;

export interface SearchHit {
  url: string;
  title: string;
  snippet: string;
  provider: ResearchProviderId;
  /** Zero-based position in that provider's answer. */
  rank: number;
}

export interface ExtractedPage {
  url: string;
  title: string;
  content: string;
}

export interface ExtractionResult {
  pages: ExtractedPage[];
  failedUrls: string[];
}

export class ResearchProviderError extends Error {
  readonly provider: ResearchProviderId;
  readonly status: number | undefined;
  /** True when the rest of this run should stop asking this provider. */
  readonly stopProvider: boolean;
  /** The request hit its limit, as opposed to being answered with an error. */
  readonly timedOut: boolean;

  constructor(provider: ResearchProviderId, reason: string, status?: number, timedOut = false) {
    super(reason);
    this.name = 'ResearchProviderError';
    this.provider = provider;
    this.status = status;
    this.timedOut = timedOut;
    this.stopProvider = status !== undefined && STOP_USING_PROVIDER.has(status);
  }
}

const braveResponse = z.object({
  web: z
    .object({
      results: z.array(
        z.object({
          url: z.string(),
          title: z.string().optional(),
          description: z.string().optional(),
        }),
      ),
    })
    .optional(),
});

const tavilySearchResponse = z.object({
  results: z.array(
    z.object({
      url: z.string(),
      title: z.string().nullish(),
      content: z.string().nullish(),
    }),
  ),
});

// Shape confirmed with a live call on 2026-11-09.
const tavilyExtractResponse = z.object({
  results: z.array(
    z.object({
      url: z.string(),
      title: z.string().nullish(),
      raw_content: z.string().nullish(),
    }),
  ),
  failed_results: z.array(z.object({ url: z.string() })).nullish(),
});

async function requestJson(
  provider: ResearchProviderId,
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetchImpl(url, { ...init, signal: controller.signal });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'AbortError';
      throw new ResearchProviderError(
        provider,
        timedOut ? `timed out after ${timeoutMs}ms` : 'the network request failed',
        undefined,
        timedOut,
      );
    }
    if (!response.ok) {
      throw new ResearchProviderError(provider, `responded ${response.status}`, response.status);
    }
    try {
      return await response.json();
    } catch {
      throw new ResearchProviderError(provider, 'returned a body that is not JSON');
    }
  } finally {
    clearTimeout(timer);
  }
}

function parseOrThrow<T>(provider: ResearchProviderId, schema: z.ZodType<T>, json: unknown): T {
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new ResearchProviderError(provider, 'returned an unexpected shape');
  return parsed.data;
}

export async function braveSearch(
  fetchImpl: FetchLike,
  apiKey: string,
  query: string,
  count: number,
  timeoutMs: number,
): Promise<SearchHit[]> {
  const params = new URLSearchParams({
    q: query,
    count: String(count),
    safesearch: 'moderate',
    text_decorations: 'false',
    result_filter: 'web',
  });
  const json = await requestJson(
    'brave',
    fetchImpl,
    `${BRAVE_URL}?${params.toString()}`,
    { method: 'GET', headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey } },
    timeoutMs,
  );
  const parsed = parseOrThrow('brave', braveResponse, json);
  return (parsed.web?.results ?? []).map((result, rank) => ({
    url: result.url,
    title: result.title ?? '',
    snippet: (result.description ?? '').slice(0, MAX_RAW_SNIPPET_CHARS),
    provider: 'brave' as const,
    rank,
  }));
}

function tavilyHeaders(apiKey: string): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
}

export async function tavilySearch(
  fetchImpl: FetchLike,
  apiKey: string,
  query: string,
  count: number,
  timeoutMs: number,
): Promise<SearchHit[]> {
  const json = await requestJson(
    'tavily',
    fetchImpl,
    TAVILY_SEARCH_URL,
    {
      method: 'POST',
      headers: tavilyHeaders(apiKey),
      body: JSON.stringify({
        query,
        search_depth: 'basic',
        max_results: count,
        include_answer: false,
        include_raw_content: false,
        include_images: false,
      }),
    },
    timeoutMs,
  );
  const parsed = parseOrThrow('tavily', tavilySearchResponse, json);
  return parsed.results.map((result, rank) => ({
    url: result.url,
    title: result.title ?? '',
    snippet: (result.content ?? '').slice(0, MAX_RAW_SNIPPET_CHARS),
    provider: 'tavily' as const,
    rank,
  }));
}

export async function tavilyExtract(
  fetchImpl: FetchLike,
  apiKey: string,
  urls: readonly string[],
  timeoutMs: number,
): Promise<ExtractionResult> {
  const json = await requestJson(
    'tavily',
    fetchImpl,
    TAVILY_EXTRACT_URL,
    {
      method: 'POST',
      headers: tavilyHeaders(apiKey),
      body: JSON.stringify({ urls, extract_depth: 'basic', format: 'text' }),
    },
    timeoutMs,
  );
  const parsed = parseOrThrow('tavily', tavilyExtractResponse, json);
  return {
    pages: parsed.results.map((result) => ({
      url: result.url,
      title: result.title ?? '',
      content: (result.raw_content ?? '').slice(0, MAX_RAW_PAGE_CHARS),
    })),
    failedUrls: (parsed.failed_results ?? []).map((failure) => failure.url),
  };
}
