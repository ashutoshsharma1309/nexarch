/**
 * Researches a product on the real web before anything is designed.
 *
 * Plan, search, read the most relevant pages, synthesise with verified
 * citations. Every step can be missing: research improves a build but must
 * never stop one, so `researchProduct` always resolves to an artifact that says
 * what was done and what could not be.
 *
 * This module never requests a discovered URL itself. Pages are read through
 * the extraction provider, after `isSafeResearchUrl`, and the only pages loaded
 * from this server are the references `lib/reference-analyzer` renders.
 */
import { generate } from '../ai-orchestrator/ai-orchestrator.service.js';
import { logger } from '../../shared/logger/index.js';
import type { RequirementSpec } from '../../shared/types/requirement.js';
import { globalResearchCache, normalizeQuery } from './lib/research-cache.js';
import type { ResearchCache } from './lib/research-cache.js';
import {
  MAX_EXTRACTIONS_PER_RUN,
  MAX_SEARCHES_PER_RUN,
  chooseBudget,
  domainLabelOf,
  fallbackObjective,
  planResearch,
} from './lib/research-planner.js';
import type { ResearchBudget, ResearchPlan } from './lib/research-planner.js';
import {
  analyzeReferences,
  buildReferenceEvidence,
  chooseReferences,
  withoutReferenceNames,
} from './lib/reference-analyzer.js';
import type { ReferenceAnalyzerDeps } from './lib/reference-analyzer.js';
import { citableSources, emptySynthesis, synthesizeResearch } from './lib/research-synthesis.js';
import type { SynthesizedFields } from './lib/research-synthesis.js';
import { sanitizeExcerpt } from './lib/sanitize.js';
import {
  ResearchProviderError,
  braveSearch,
  tavilyExtract,
  tavilySearch,
} from './lib/search-providers.js';
import type { ExtractedPage, FetchLike, SearchHit } from './lib/search-providers.js';
import {
  describeRejectedUrl,
  isSafeResearchUrl,
  normalizeResearchUrl,
  sourceIdFor,
  urlDedupeKey,
} from './lib/url-safety.js';
import { RESEARCH_ARTIFACT_VERSION } from './web-research.types.js';
import type {
  ReferenceAnalysis,
  ResearchArtifact,
  ResearchProviderId,
  ResearchQueryRecord,
  ResearchSource,
  ResearchUsage,
} from './web-research.types.js';

/** Both providers measured 1-2s uncontended; a limit is for stalls, not speed. */
const SEARCH_TIMEOUT_MS = 15_000;
/**
 * Two in a row is a stalled provider, and every further query would stall the
 * same way, one after another, out of the time synthesis needs.
 */
const MAX_CONSECUTIVE_SEARCH_TIMEOUTS = 2;
const EXTRACT_TIMEOUT_MS = 35_000;
const SYNTHESIS_TIMEOUT_MS = 150_000;
const RUN_DEADLINE_MS = 240_000;
/** Below this a synthesis call has no realistic chance of finishing. */
const MIN_SYNTHESIS_WINDOW_MS = 20_000;
const MAX_REFERENCE_WINDOW_MS = 75_000;
/** Too short to load and measure even one site at both widths. */
const MIN_REFERENCE_WINDOW_MS = 12_000;
/** Rendering must not eat the time synthesis needs: a live call has taken 46s. */
const RESERVED_FOR_SYNTHESIS_MS = 70_000;
const MAX_REFERENCE_EVIDENCE_CHARS = 9_000;

const RESULTS_PER_QUERY = 8;
const MAX_REFERENCE_URLS = 5;
const MAX_PAGES_PER_HOST = 2;
/** Shorter than this is a cookie wall or a "please enable JavaScript" page. */
const MIN_EXTRACTED_CHARS = 120;
const PAGE_EXCERPT_CHARS = 3_000;
const SNIPPET_EXCERPT_CHARS = 500;
const TITLE_CHARS = 160;
/** Brave's entry plan allows one request per second. */
const DEFAULT_BRAVE_SPACING_MS = 1_100;

/** Sites that appear in results but do not give a page reader useful content. */
const POOR_EXTRACTION_HOSTS = [
  'facebook.com',
  'instagram.com',
  'tiktok.com',
  'x.com',
  'twitter.com',
  'pinterest.com',
  'youtube.com',
  'linkedin.com',
];

export interface ResearchInput {
  prompt: string;
  spec: RequirementSpec;
  referenceUrls?: readonly string[] | undefined;
}

export interface ResearchDeps {
  fetch?: FetchLike;
  generate?: typeof generate;
  cache?: ResearchCache;
  /** Defaults to `process.env`. */
  env?: Readonly<Record<string, string | undefined>>;
  /** Pause between Brave requests. */
  braveSpacingMs?: number;
  /** Can only lower the per-run caps, never raise them. */
  limits?: { maxSearches?: number; maxExtractions?: number };
  /** Without an injected `launch`, nothing is rendered under test. */
  references?: ReferenceAnalyzerDeps;
}

interface Candidate {
  url: string;
  dedupeKey: string;
  title: string;
  snippet: string;
  provider: ResearchProviderId;
  score: number;
  isReference: boolean;
}

interface RunState {
  fetchImpl: FetchLike;
  braveKey: string | undefined;
  tavilyKey: string | undefined;
  cache: ResearchCache;
  braveSpacingMs: number;
  maxSearches: number;
  maxExtractions: number;
  deadline: number;
  usage: ResearchUsage;
  queries: ResearchQueryRecord[];
  limitations: Set<string>;
  stoppedProviders: Set<ResearchProviderId>;
  consecutiveSearchTimeouts: Map<ResearchProviderId, number>;
  /** Anything that means the research is less than a full run. */
  degraded: boolean;
  renderReferences: boolean;
  referenceAnalyses: ReferenceAnalysis[];
}

function emptyUsage(): ResearchUsage {
  return {
    searches: 0,
    extractions: 0,
    extractionRequests: 0,
    searchCacheHits: 0,
    extractionCacheHits: 0,
    byProvider: { brave: { searches: 0 }, tavily: { searches: 0, extractions: 0 } },
    modelCalls: [],
    durationMs: 0,
    notes: [],
  };
}

function providerName(provider: ResearchProviderId): string {
  return provider === 'brave' ? 'Brave Search' : 'Tavily';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function keyFor(state: RunState, provider: ResearchProviderId): string | undefined {
  return provider === 'brave' ? state.braveKey : state.tavilyKey;
}

function isUsable(state: RunState, provider: ResearchProviderId): boolean {
  return keyFor(state, provider) !== undefined && !state.stoppedProviders.has(provider);
}

type SearchAttempt = 'done' | 'failed' | 'skipped';

async function searchOnce(
  state: RunState,
  provider: ResearchProviderId,
  query: string,
  hits: SearchHit[],
): Promise<SearchAttempt> {
  const cacheKey = `${provider}:${normalizeQuery(query)}`;
  const cached = state.cache.searches.get(cacheKey);
  if (cached) {
    state.usage.searchCacheHits += 1;
    state.queries.push({ query, provider, results: cached.length, fromCache: true });
    hits.push(...cached);
    return 'done';
  }

  const apiKey = keyFor(state, provider);
  if (apiKey === undefined) return 'skipped';
  if (state.usage.searches >= state.maxSearches) {
    state.limitations.add(`The per-run cap of ${state.maxSearches} searches was reached.`);
    state.degraded = true;
    return 'skipped';
  }
  if (Date.now() >= state.deadline) {
    state.limitations.add('The research time limit was reached before every search ran.');
    state.degraded = true;
    return 'skipped';
  }

  // Counted before the await: a failed or timed-out request may still be billed.
  state.usage.searches += 1;
  state.usage.byProvider[provider].searches += 1;
  try {
    const search = provider === 'brave' ? braveSearch : tavilySearch;
    const results = await search(
      state.fetchImpl,
      apiKey,
      query,
      RESULTS_PER_QUERY,
      SEARCH_TIMEOUT_MS,
    );
    state.consecutiveSearchTimeouts.delete(provider);
    state.cache.searches.set(cacheKey, results);
    state.queries.push({ query, provider, results: results.length, fromCache: false });
    hits.push(...results);
    return 'done';
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'failed';
    state.limitations.add(`${providerName(provider)} search failed: ${reason}.`);
    state.degraded = true;
    if (error instanceof ResearchProviderError && error.stopProvider) {
      state.stoppedProviders.add(provider);
    }
    if (error instanceof ResearchProviderError && error.timedOut) {
      const timeouts = (state.consecutiveSearchTimeouts.get(provider) ?? 0) + 1;
      state.consecutiveSearchTimeouts.set(provider, timeouts);
      if (timeouts >= MAX_CONSECUTIVE_SEARCH_TIMEOUTS) {
        state.stoppedProviders.add(provider);
        state.limitations.add(
          `${providerName(provider)} stopped responding, so its remaining searches were skipped.`,
        );
      }
    }
    return 'failed';
  }
}

/** One provider's queries in order. Returns the ones the other provider should try. */
async function runLane(
  state: RunState,
  provider: ResearchProviderId,
  queries: readonly string[],
  hits: SearchHit[],
): Promise<string[]> {
  const unserved: string[] = [];
  let sentAny = false;
  for (const query of queries) {
    if (!isUsable(state, provider)) {
      unserved.push(query);
      continue;
    }
    if (provider === 'brave' && sentAny && state.braveSpacingMs > 0) {
      await delay(state.braveSpacingMs);
    }
    sentAny = true;
    const outcome = await searchOnce(state, provider, query, hits);
    if (outcome !== 'done') unserved.push(query);
  }
  return unserved;
}

async function runSearches(state: RunState, plan: ResearchPlan): Promise<SearchHit[]> {
  const hits: SearchHit[] = [];
  // Brave finds real sites, Tavily answers focused questions; each covers for the other.
  const [forTavily, forBrave] = await Promise.all([
    runLane(state, 'brave', plan.discoveryQueries, hits),
    runLane(state, 'tavily', plan.researchQueries, hits),
  ]);
  await runLane(state, 'tavily', forTavily, hits);
  await runLane(state, 'brave', forBrave, hits);
  return hits;
}

function rejectUnsafe(url: string, rejected: Set<string>): boolean {
  if (isSafeResearchUrl(url)) return false;
  rejected.add(describeRejectedUrl(url));
  return true;
}

function collectCandidates(
  state: RunState,
  hits: readonly SearchHit[],
  referenceUrls: readonly string[],
): Map<string, Candidate> {
  const candidates = new Map<string, Candidate>();
  const rejected = new Set<string>();

  for (const raw of referenceUrls.slice(0, MAX_REFERENCE_URLS)) {
    const url = normalizeResearchUrl(raw);
    const dedupeKey = urlDedupeKey(raw);
    if (rejectUnsafe(raw, rejected) || url === null || dedupeKey === null) continue;
    candidates.set(dedupeKey, {
      url,
      dedupeKey,
      title: '',
      snippet: '',
      provider: 'tavily',
      score: Number.MAX_SAFE_INTEGER,
      isReference: true,
    });
  }
  if (referenceUrls.length > MAX_REFERENCE_URLS) {
    state.limitations.add(`Only the first ${MAX_REFERENCE_URLS} reference URLs were considered.`);
  }

  for (const hit of hits) {
    if (rejectUnsafe(hit.url, rejected)) continue;
    const url = normalizeResearchUrl(hit.url);
    const dedupeKey = urlDedupeKey(hit.url);
    if (url === null || dedupeKey === null) continue;
    // Ranking near the top of several searches beats ranking first in one.
    const score = 1 / (hit.rank + 1);
    const existing = candidates.get(dedupeKey);
    if (!existing) {
      candidates.set(dedupeKey, {
        url,
        dedupeKey,
        title: hit.title,
        snippet: hit.snippet,
        provider: hit.provider,
        score,
        isReference: false,
      });
      continue;
    }
    if (!existing.isReference) existing.score += score;
    if (existing.title === '') existing.title = hit.title;
    if (existing.snippet === '') {
      existing.snippet = hit.snippet;
      existing.provider = hit.provider;
    }
  }

  if (rejected.size > 0) {
    state.limitations.add(
      `Refused ${rejected.size} unsafe URL(s): ${[...rejected].slice(0, 5).join(', ')}.`,
    );
  }
  return candidates;
}

function hostOf(url: string): string {
  return new URL(url).hostname.replace(/^www\./, '');
}

function isPoorExtractionHost(host: string): boolean {
  return POOR_EXTRACTION_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
}

/** The best candidates, references first, without letting one site fill the list. */
function chooseExtractionTargets(
  candidates: readonly Candidate[],
  budget: ResearchBudget,
  maxExtractions: number,
): Candidate[] {
  const limit = Math.min(budget.extractions, maxExtractions);
  const perHost = new Map<string, number>();
  const chosen: Candidate[] = [];
  for (const candidate of [...candidates].sort((a, b) => b.score - a.score)) {
    if (chosen.length === limit) break;
    const host = hostOf(candidate.url);
    const taken = perHost.get(host) ?? 0;
    if (!candidate.isReference && (taken >= MAX_PAGES_PER_HOST || isPoorExtractionHost(host))) {
      continue;
    }
    perHost.set(host, taken + 1);
    chosen.push(candidate);
  }
  return chosen;
}

async function extractPages(
  state: RunState,
  targets: readonly Candidate[],
): Promise<Map<string, ExtractedPage>> {
  const pages = new Map<string, ExtractedPage>();
  if (targets.length === 0) return pages;

  const toFetch: Candidate[] = [];
  for (const target of targets) {
    const cached = state.cache.pages.get(target.dedupeKey);
    if (cached) {
      state.usage.extractionCacheHits += 1;
      pages.set(target.dedupeKey, cached);
    } else {
      toFetch.push(target);
    }
  }

  const apiKey = state.tavilyKey;
  if (toFetch.length === 0 || apiKey === undefined) return pages;
  if (state.stoppedProviders.has('tavily') || Date.now() >= state.deadline) return pages;

  const remaining = Math.max(0, state.maxExtractions - state.usage.extractions);
  const batch = toFetch.slice(0, remaining);
  if (batch.length < toFetch.length) {
    state.limitations.add(
      `The per-run cap of ${state.maxExtractions} page extractions was reached.`,
    );
    state.degraded = true;
  }
  if (batch.length === 0) return pages;

  state.usage.extractionRequests += 1;
  state.usage.extractions += batch.length;
  state.usage.byProvider.tavily.extractions += batch.length;
  try {
    const result = await tavilyExtract(
      state.fetchImpl,
      apiKey,
      batch.map((target) => target.url),
      EXTRACT_TIMEOUT_MS,
    );
    const requested = new Set(batch.map((target) => target.dedupeKey));
    for (const page of result.pages) {
      const dedupeKey = urlDedupeKey(page.url);
      // Only pages that were asked for: a redirect target has not been vetted.
      if (dedupeKey === null || !requested.has(dedupeKey)) continue;
      pages.set(dedupeKey, page);
      state.cache.pages.set(dedupeKey, page);
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'failed';
    state.limitations.add(`Tavily page extraction failed: ${reason}.`);
    state.degraded = true;
    if (error instanceof ResearchProviderError && error.stopProvider) {
      state.stoppedProviders.add('tavily');
    }
  }
  return pages;
}

function buildSource(
  candidate: Candidate,
  page: ExtractedPage | undefined,
  accessedAt: string,
): ResearchSource {
  const pageTitle = page?.title ?? '';
  const title = sanitizeExcerpt(pageTitle === '' ? candidate.title : pageTitle, TITLE_CHARS);
  const base = {
    id: sourceIdFor(candidate.dedupeKey),
    url: candidate.url,
    title: title.text === '' ? hostOf(candidate.url) : title.text,
    accessedAt,
  };

  const extracted = page ? sanitizeExcerpt(page.content, PAGE_EXCERPT_CHARS) : null;
  if (extracted && extracted.text.length >= MIN_EXTRACTED_CHARS) {
    return {
      ...base,
      provider: 'tavily',
      retrievalKind: 'extracted-page',
      excerpt: extracted.text,
      flaggedLines: [...new Set([...title.flaggedLines, ...extracted.flaggedLines])],
    };
  }

  const snippet = sanitizeExcerpt(candidate.snippet, SNIPPET_EXCERPT_CHARS);
  return {
    ...base,
    provider: candidate.provider,
    retrievalKind: snippet.text === '' ? 'unreachable' : 'search-snippet',
    excerpt: snippet.text,
    flaggedLines: [
      ...new Set([
        ...title.flaggedLines,
        ...snippet.flaggedLines,
        ...(extracted?.flaggedLines ?? []),
      ]),
    ],
  };
}

function buildSources(
  state: RunState,
  candidates: Map<string, Candidate>,
  targets: readonly Candidate[],
  pages: ReadonlyMap<string, ExtractedPage>,
  budget: ResearchBudget,
): ResearchSource[] {
  const accessedAt = new Date().toISOString();
  const targetKeys = new Set(targets.map((target) => target.dedupeKey));
  // Sources that hold page text must not lose their slot to a bare snippet.
  const ordered = [...candidates.values()].sort(
    (a, b) =>
      Number(targetKeys.has(b.dedupeKey)) - Number(targetKeys.has(a.dedupeKey)) ||
      b.score - a.score,
  );
  if (ordered.length > budget.maxSources) {
    state.limitations.add(
      `Kept the ${budget.maxSources} most relevant of ${ordered.length} sources found.`,
    );
  }
  const sources = ordered
    .slice(0, budget.maxSources)
    .map((candidate) => buildSource(candidate, pages.get(candidate.dedupeKey), accessedAt));

  const unreadTargets = sources.filter(
    (source) =>
      source.retrievalKind !== 'extracted-page' &&
      targets.some((target) => sourceIdFor(target.dedupeKey) === source.id),
  );
  if (unreadTargets.length > 0) {
    state.limitations.add(
      `${unreadTargets.length} page(s) selected for reading could not be read, and rest on a search snippet or nothing.`,
    );
  }

  const unreachable = sources.filter((source) => source.retrievalKind === 'unreachable');
  if (unreachable.length > 0) {
    state.limitations.add(
      `Could not access: ${unreachable.map((source) => hostOf(source.url)).join(', ')}.`,
    );
    state.degraded = true;
  }
  return sources;
}

function recordInjectionFlags(state: RunState, sources: readonly ResearchSource[]): void {
  const flagged = sources.filter((source) => source.flaggedLines.length > 0);
  if (flagged.length === 0) return;
  const lines = flagged.reduce((sum, source) => sum + source.flaggedLines.length, 0);
  state.limitations.add(
    `${lines} line(s) from ${flagged.length} source(s) looked like prompt injection and were withheld: ${flagged.map((source) => source.id).join(', ')}.`,
  );
}

function finishUsage(state: RunState, startedAt: number): void {
  state.usage.durationMs = Date.now() - startedAt;
  if (state.usage.searches + state.usage.extractions > 0) {
    state.usage.notes.push(
      'Brave and Tavily do not report a price per request, so search and extraction cost is unavailable.',
    );
  }
  for (const call of state.usage.modelCalls) {
    if (call.note !== null) state.usage.notes.push(`${call.purpose}: ${call.note}.`);
  }
}

function assemble(
  state: RunState,
  startedAt: number,
  details: {
    objective: string;
    domainLabel: string;
    depth: ResearchArtifact['depth'];
    status: ResearchArtifact['status'];
    questions: string[];
    sources: ResearchSource[];
    fields: SynthesizedFields;
  },
): ResearchArtifact {
  finishUsage(state, startedAt);
  const { fields, ...rest } = details;
  return {
    version: RESEARCH_ARTIFACT_VERSION,
    generatedAt: new Date().toISOString(),
    ...rest,
    limitations: [...state.limitations],
    queries: state.queries,
    ...fields,
    referenceAnalyses: state.referenceAnalyses,
    usage: state.usage,
  };
}

/** Renders references where a browser exists. A missing one is noted, and costs no status. */
async function measureReferences(
  state: RunState,
  input: ResearchInput,
  candidates: ReadonlyMap<string, Candidate>,
  deps: ResearchDeps,
): Promise<void> {
  if (!state.renderReferences) return;
  const ranked = [...candidates.values()]
    .filter((candidate) => !candidate.isReference && !isPoorExtractionHost(hostOf(candidate.url)))
    .sort((a, b) => b.score - a.score)
    .map((candidate) => candidate.url);
  const targets = chooseReferences(
    (input.referenceUrls ?? []).slice(0, MAX_REFERENCE_URLS),
    ranked,
  );
  if (targets.length === 0) {
    state.limitations.add('No suitable site was found to render as a design reference.');
    return;
  }
  const window = Math.min(
    MAX_REFERENCE_WINDOW_MS,
    deps.references?.timeBudgetMs ?? MAX_REFERENCE_WINDOW_MS,
    state.deadline - Date.now() - RESERVED_FOR_SYNTHESIS_MS,
  );
  if (window < MIN_REFERENCE_WINDOW_MS) {
    state.limitations.add('Too little time remained to render reference sites.');
    return;
  }
  const outcome = await analyzeReferences(targets, { ...deps.references, timeBudgetMs: window });
  state.referenceAnalyses = outcome.analyses;
  for (const limitation of outcome.limitations) state.limitations.add(limitation);
}

function capOf(requested: number | undefined, hardCap: number): number {
  return requested === undefined ? hardCap : Math.min(Math.max(0, requested), hardCap);
}

async function run(
  input: ResearchInput,
  deps: ResearchDeps,
  state: RunState,
  startedAt: number,
): Promise<ResearchArtifact> {
  const generateFn = deps.generate ?? generate;
  const budget = chooseBudget(input.spec);

  const planned = await planResearch(input, budget, generateFn);
  const { plan } = planned;
  if (planned.modelCall) state.usage.modelCalls.push(planned.modelCall);
  if (planned.limitation !== null) {
    state.limitations.add(planned.limitation);
    state.degraded = true;
  }

  for (const provider of ['brave', 'tavily'] as const) {
    if (keyFor(state, provider) === undefined) {
      state.limitations.add(
        `${providerName(provider)} has no API key configured, so it was not used.`,
      );
      state.degraded = true;
    }
  }

  const hits = await runSearches(state, plan);
  const candidates = collectCandidates(state, hits, input.referenceUrls ?? []);
  const targets =
    state.tavilyKey === undefined
      ? []
      : chooseExtractionTargets(
          [...candidates.values()],
          plan.degraded ? { ...budget, extractions: Math.min(budget.extractions, 2) } : budget,
          state.maxExtractions,
        );
  const pages = await extractPages(state, targets);
  const sources = buildSources(state, candidates, targets, pages, budget);
  recordInjectionFlags(state, sources);
  await measureReferences(state, input, candidates, deps);

  const searchRan = state.queries.length > 0;
  const details = {
    objective: plan.objective,
    domainLabel: plan.domainLabel,
    depth: budget.depth,
    questions: searchRan ? plan.questions : [],
    sources,
  };

  if (citableSources(sources).length === 0) {
    state.limitations.add(
      'No usable web evidence was gathered, so this research contains no findings.',
    );
    return assemble(state, startedAt, {
      ...details,
      status: 'unavailable',
      fields: emptySynthesis(),
    });
  }

  const readPages = sources.filter((source) => source.retrievalKind === 'extracted-page').length;
  if (readPages === 0) {
    state.limitations.add(
      'No page content could be read, so all evidence is search-engine snippets.',
    );
    state.degraded = true;
  }

  const remainingMs = state.deadline - Date.now();
  if (remainingMs < MIN_SYNTHESIS_WINDOW_MS) {
    state.limitations.add('The research time limit was reached before synthesis could run.');
    return assemble(state, startedAt, { ...details, status: 'partial', fields: emptySynthesis() });
  }

  const synthesis = await synthesizeResearch(
    {
      prompt: input.prompt,
      objective: plan.objective,
      domainLabel: plan.domainLabel,
      questions: plan.questions,
      sources,
      maxEvidenceChars: budget.maxEvidenceChars,
      timeoutMs: Math.min(remainingMs, SYNTHESIS_TIMEOUT_MS),
      referenceEvidence: buildReferenceEvidence(
        state.referenceAnalyses,
        MAX_REFERENCE_EVIDENCE_CHARS,
      ),
    },
    generateFn,
  );
  if (synthesis.modelCall) state.usage.modelCalls.push(synthesis.modelCall);
  for (const limitation of synthesis.limitations) state.limitations.add(limitation);

  const direction = withoutReferenceNames(
    synthesis.fields.visualDirection,
    state.referenceAnalyses,
  );
  if (direction.dropped > 0) {
    state.limitations.add(
      `${direction.dropped} visual direction line(s) named a reference site and were removed.`,
    );
  }

  return assemble(state, startedAt, {
    ...details,
    status: synthesis.succeeded && !state.degraded ? 'complete' : 'partial',
    fields: { ...synthesis.fields, visualDirection: direction.kept },
  });
}

/** Never throws. With nothing to work with it returns `unavailable` and says why. */
export async function researchProduct(
  input: ResearchInput,
  deps: ResearchDeps = {},
): Promise<ResearchArtifact> {
  const startedAt = Date.now();
  const env = deps.env ?? process.env;
  // Under test the network is reachable only through an injected fetch.
  const fetchImpl = deps.fetch ?? (process.env.NODE_ENV === 'test' ? null : globalThis.fetch);
  const key = (name: string): string | undefined => {
    const value = env[name]?.trim();
    return value === '' ? undefined : value;
  };

  const state: RunState = {
    fetchImpl:
      fetchImpl ??
      ((): never => {
        throw new Error('network disabled');
      }),
    braveKey: key('BRAVE_SEARCH_API_KEY'),
    tavilyKey: key('TAVILY_API_KEY'),
    cache: deps.cache ?? globalResearchCache,
    braveSpacingMs: deps.braveSpacingMs ?? DEFAULT_BRAVE_SPACING_MS,
    maxSearches: capOf(deps.limits?.maxSearches, MAX_SEARCHES_PER_RUN),
    maxExtractions: capOf(deps.limits?.maxExtractions, MAX_EXTRACTIONS_PER_RUN),
    deadline: startedAt + RUN_DEADLINE_MS,
    usage: emptyUsage(),
    queries: [],
    limitations: new Set(),
    stoppedProviders: new Set(),
    consecutiveSearchTimeouts: new Map(),
    degraded: false,
    renderReferences:
      env.WEB_RESEARCH_RENDER_REFERENCES?.trim().toLowerCase() !== 'false' &&
      (process.env.NODE_ENV !== 'test' || deps.references?.launch !== undefined),
    referenceAnalyses: [],
  };

  const unavailable = (reason: string): ResearchArtifact => {
    state.limitations.add(reason);
    return assemble(state, startedAt, {
      objective: fallbackObjective(input),
      domainLabel: domainLabelOf(input.spec),
      depth: chooseBudget(input.spec).depth,
      status: 'unavailable',
      questions: [],
      sources: [],
      fields: emptySynthesis(),
    });
  };

  try {
    if (env.WEB_RESEARCH_ENABLED?.trim().toLowerCase() === 'false') {
      return unavailable('Web research is turned off by WEB_RESEARCH_ENABLED=false.');
    }
    if (fetchImpl === null) return unavailable('Web research makes no network calls under test.');
    if (state.braveKey === undefined && state.tavilyKey === undefined) {
      return unavailable(
        'No web research provider is configured (Brave Search and Tavily have no API key).',
      );
    }
    return await run(input, deps, state, startedAt);
  } catch (error) {
    logger.warn('Web research failed unexpectedly', {
      reason: error instanceof Error ? error.message : String(error),
    });
    return unavailable('Web research stopped on an internal error.');
  }
}

export interface EvidenceBriefOptions {
  maxChars?: number;
}

const DEFAULT_BRIEF_CHARS = 4_000;

/**
 * The evidence as later stages will read it.
 *
 * Only verified findings and sanitised text reach it; withheld lines never do.
 * It still derives from web content, so pass it as `untrustedData`.
 */
export function formatEvidenceBrief(
  artifact: ResearchArtifact,
  options: EvidenceBriefOptions = {},
): string {
  const maxChars = options.maxChars ?? DEFAULT_BRIEF_CHARS;
  const pages = artifact.sources.filter((s) => s.retrievalKind === 'extracted-page').length;
  const snippets = artifact.sources.filter((s) => s.retrievalKind === 'search-snippet').length;

  if (artifact.findings.length === 0 && artifact.decisions.length === 0) {
    return [
      `Web research status: ${artifact.status}. It produced no verified findings, so do not claim any research informed this work.`,
      ...artifact.limitations.slice(0, 3).map((limitation) => `- ${limitation}`),
    ]
      .join('\n')
      .slice(0, maxChars);
  }

  const section = (title: string, items: readonly string[]): string[] =>
    items.length === 0 ? [] : [title, ...items.map((item) => `- ${item}`)];

  const lines = [
    `Web research (${artifact.status}, ${artifact.depth}): ${artifact.domainLabel}. ${pages} page(s) read, ${snippets} search snippet(s) only.`,
    `Objective: ${artifact.objective}`,
    ...section(
      'Findings:',
      artifact.findings.map((f) => `[${f.confidence}] ${f.statement} (${f.sourceIds.join(', ')})`),
    ),
    ...section(
      'Decisions:',
      artifact.decisions.map(
        (d) =>
          `[${d.confidence}] ${d.decision} Because: ${d.rationale} (${d.sourceIds.join(', ')})`,
      ),
    ),
    // None of these carries a citation, so none is presented as a finding.
    ...section('Common patterns (model suggestion, not sourced):', artifact.commonPatterns),
    ...section('Visual direction (model suggestion, not sourced):', artifact.visualDirection),
    ...section('Features (model suggestion, not sourced):', artifact.featureRecommendations),
    ...section('UX patterns (model suggestion, not sourced):', artifact.uxPatterns),
    ...section('Interactions (model suggestion, not sourced):', artifact.interactions),
    ...section('Assets needed (model suggestion, not sourced):', artifact.assetRequirements),
    ...section(
      'Implementation (model suggestion, not sourced):',
      artifact.implementationRecommendations,
    ),
    ...section('Limitations:', artifact.limitations.slice(0, 4)),
  ];

  // Whole lines only: half a citation reads as a claim with no source.
  const kept: string[] = [];
  let used = 0;
  for (const line of lines) {
    if (used + line.length + 1 > maxChars) break;
    kept.push(line);
    used += line.length + 1;
  }
  return kept.join('\n');
}
