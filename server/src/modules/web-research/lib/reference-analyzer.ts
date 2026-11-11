/**
 * Measures how real reference sites are built by rendering them.
 *
 * Text extraction cannot see layout, type or colour, so a page has to be loaded
 * in a browser. Only numbers and fixed categories come back: page copy, code,
 * images and names are never stored as design output.
 *
 * WHAT THIS PROTECTS AGAINST. Requests to private, loopback and link-local
 * addresses, on every request and every redirect hop, with the check inside the
 * DNS lookup of the connection itself. Non-http(s) schemes, non-GET requests,
 * downloads, WebSockets, service workers, popups, dialogs, cookies and stored
 * state. Runaway pages, through caps on requests, bytes and time, and by
 * running one browser at a time and always closing it.
 *
 * WHAT THIS DOES NOT PROTECT AGAINST. It is not an OS sandbox: a Chromium
 * exploit in a page runs with this server's privileges, limited only by
 * Chromium's own sandbox (enabled here; launch fails rather than disabling it),
 * so an unpatched browser is the real exposure. Traffic Chromium originates
 * below the page's request layer is not routed: WebRTC is limited by a launch
 * flag and `<link rel=preconnect>` can still open a bare socket, although no
 * request is ever sent over it. Pages see this machine's public IP, and sites
 * can record that the visit happened. Measurements come from a script running
 * inside the page, so a hostile page can lie about its own design; validation
 * bounds what a lie can contain, not whether it is true. The one-at-a-time rule
 * holds within a process: several server processes would each run a browser.
 */
import { logger } from '../../../shared/logger/index.js';
import type { ReferenceAnalysis, ReferenceMeasurements } from '../web-research.types.js';
import { withTimeout } from './model-calls.js';
import { COLLECTOR_SCRIPT, SCROLL_SCRIPT } from './reference-collector.js';
import {
  inaccessibleAnalysis,
  measuredAnalysis,
  sanitizeMeasurement,
} from './reference-measurements.js';
import type { ReferenceOrigin } from './reference-measurements.js';
import {
  ReferenceNetworkError,
  createNodeTransport,
  createRouteGuard,
  guardedFetch,
} from './reference-network.js';
import type { HopTransport, NodeTransport, RenderBudget, RouteLike } from './reference-network.js';
import { describeRejectedUrl, isSafeResearchUrl, urlDedupeKey } from './url-safety.js';

/** Hard limit: rendering is the most expensive and exposed step in research. */
export const MAX_REFERENCE_ANALYSES = 4;
const DEFAULT_TIME_BUDGET_MS = 75_000;
/** Playwright's own default is three minutes, longer than research has. */
const LAUNCH_TIMEOUT_MS = 20_000;
/** Per reference, across both viewports. */
const REFERENCE_DEADLINE_MS = 35_000;
const NAVIGATION_TIMEOUT_MS = 15_000;
const LOAD_SETTLE_MS = 5_000;
const SCRIPT_TIMEOUT_MS = 6_000;
const REQUEST_TIMEOUT_MS = 12_000;
const CLOSE_TIMEOUT_MS = 5_000;

const MAX_DOCUMENT_BYTES = 3 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_PAGE_BYTES = 20 * 1024 * 1024;
const MAX_REQUESTS_PER_RENDER = 150;
/** Below this the page rendered as an error shell or a blank frame. */
const MIN_RENDERED_ELEMENTS = 12;

/**
 * Says what it is, in a form sites accept. It is not disguised as a person's
 * browser, and a site that refuses it is recorded as refusing it.
 */
const DESKTOP_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 NexArchReferenceAnalyzer/1.0';
const MOBILE_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36 NexArchReferenceAnalyzer/1.0';

const DESKTOP_VIEWPORT = { width: 1440, height: 900 };
const MOBILE_VIEWPORT = { width: 390, height: 844 };

const LAUNCH_ARGS = [
  '--disable-dev-shm-usage',
  '--disable-background-networking',
  '--disable-sync',
  '--no-first-run',
  '--dns-prefetch-disable',
  '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
  // Keeps cross-site frames in the process whose requests are being routed.
  '--disable-features=IsolateOrigins,site-per-process',
];

/** The small part of Playwright used here, so tests can stand in for it. */
export interface PageLike {
  goto(url: string, options: { waitUntil: 'domcontentloaded'; timeout: number }): Promise<unknown>;
  waitForLoadState(state: 'load', options: { timeout: number }): Promise<void>;
  evaluate(script: string): Promise<unknown>;
  on(event: 'dialog', handler: (dialog: { dismiss(): Promise<void> }) => void): unknown;
}

export interface ContextLike {
  route(pattern: string, handler: (route: RouteLike) => Promise<void>): Promise<void>;
  routeWebSocket?(
    pattern: RegExp,
    handler: (socket: { close(): Promise<void> }) => void,
  ): Promise<void>;
  on(event: 'page', handler: (page: { close(): Promise<void> }) => void): unknown;
  newPage(): Promise<PageLike>;
  close(): Promise<void>;
}

export interface ContextOptions {
  viewport: { width: number; height: number };
  userAgent: string;
  isMobile: boolean;
  hasTouch: boolean;
  javaScriptEnabled: true;
  acceptDownloads: false;
  serviceWorkers: 'block';
  bypassCSP: false;
  ignoreHTTPSErrors: false;
}

export interface BrowserLike {
  newContext(options: ContextOptions): Promise<ContextLike>;
  close(): Promise<void>;
}

export type BrowserLauncher = () => Promise<BrowserLike>;

export class BrowserUnavailableError extends Error {}

/** A variable specifier: the production image has no Playwright, and that must not break the build. */
export async function launchChromium(): Promise<BrowserLike> {
  const specifier = 'playwright';
  let playwright: { chromium: { launch(options: object): Promise<unknown> } };
  try {
    playwright = (await import(specifier)) as typeof playwright;
  } catch {
    throw new BrowserUnavailableError('Playwright is not installed on this server');
  }
  try {
    const browser = await playwright.chromium.launch({
      headless: true,
      chromiumSandbox: true,
      timeout: LAUNCH_TIMEOUT_MS,
      args: LAUNCH_ARGS,
    });
    return browser as BrowserLike;
  } catch {
    // Launch errors carry local paths. Either cause means the same to a reader.
    throw new BrowserUnavailableError(
      'Chromium could not be started (its binary may be missing, or its sandbox unavailable)',
    );
  }
}

let renderQueue: Promise<unknown> = Promise.resolve();

/** Serialises analyses: one browser at a time, however many builds run at once. */
function oneAtATime<T>(work: () => Promise<T>): Promise<T> {
  const next = renderQueue.then(work, work);
  renderQueue = next.catch(() => undefined);
  return next;
}

async function closeQuietly(close: () => Promise<void>, what: string): Promise<void> {
  try {
    await withTimeout(close(), CLOSE_TIMEOUT_MS);
  } catch (error) {
    logger.warn(`Reference analysis could not close its ${what}`, {
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

function failureReason(error: unknown): string {
  if (error instanceof ReferenceNetworkError) {
    if (error.kind === 'unsafe') return `It was refused because ${error.message}`;
    if (error.kind === 'too-large') return 'It was larger than the page size limit';
    if (error.kind === 'too-many-redirects') return `It could not be reached: ${error.message}`;
    return `It could not be reached (${error.message})`;
  }
  const message = error instanceof Error ? error.message : '';
  const networkCode = /net::(ERR_[A-Z_]+)/.exec(message)?.[1];
  if (networkCode !== undefined) return `It failed to load (${networkCode})`;
  if (/time(d)? ?out/i.test(message)) return 'It did not finish loading in time';
  return 'It could not be rendered';
}

interface ViewportShape {
  name: 'desktop' | 'mobile';
  viewport: { width: number; height: number };
  userAgent: string;
  isMobile: boolean;
}

const DESKTOP: ViewportShape = {
  name: 'desktop',
  viewport: DESKTOP_VIEWPORT,
  userAgent: DESKTOP_USER_AGENT,
  isMobile: false,
};
const MOBILE: ViewportShape = {
  name: 'mobile',
  viewport: MOBILE_VIEWPORT,
  userAgent: MOBILE_USER_AGENT,
  isMobile: true,
};

type RenderResult =
  | { ok: true; measurement: ReferenceMeasurements['desktop']; truncated: boolean }
  | { ok: false; reason: string };

interface RenderTools {
  browser: BrowserLike;
  transport: HopTransport;
}

async function renderViewport(
  tools: RenderTools,
  url: string,
  shape: ViewportShape,
  deadline: number,
): Promise<RenderResult> {
  const budget: RenderBudget = {
    requestsLeft: MAX_REQUESTS_PER_RENDER,
    bytesLeft: MAX_PAGE_BYTES,
    exhausted: false,
  };
  const timeLeft = (cap: number): number => Math.max(1, Math.min(cap, deadline - Date.now()));
  let context: ContextLike | undefined;
  try {
    // A fresh context per render: nothing carries over between sites or viewports.
    context = await tools.browser.newContext({
      viewport: shape.viewport,
      userAgent: shape.userAgent,
      isMobile: shape.isMobile,
      hasTouch: shape.isMobile,
      javaScriptEnabled: true,
      acceptDownloads: false,
      serviceWorkers: 'block',
      bypassCSP: false,
      ignoreHTTPSErrors: false,
    });
    const guard = createRouteGuard({
      transport: tools.transport,
      userAgent: shape.userAgent,
      budget,
      maxResponseBytes: MAX_RESPONSE_BYTES,
      requestTimeoutMs: REQUEST_TIMEOUT_MS,
    });
    await context.route('**/*', guard);
    // Interception does not see WebSockets, so they are closed outright.
    await context.routeWebSocket?.(/.*/, (socket) => {
      void socket.close().catch(() => undefined);
    });
    const page = await context.newPage();
    page.on('dialog', (dialog) => {
      void dialog.dismiss().catch(() => undefined);
    });
    // Attached after the first page exists: from here on, a new page is a popup.
    context.on('page', (popup) => {
      void popup.close().catch(() => undefined);
    });

    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: timeLeft(NAVIGATION_TIMEOUT_MS),
    });
    // Slow third-party scripts are common, and the layout is usually final without them.
    await page
      .waitForLoadState('load', { timeout: timeLeft(LOAD_SETTLE_MS) })
      .catch(() => undefined);
    await withTimeout(page.evaluate(SCROLL_SCRIPT), timeLeft(SCRIPT_TIMEOUT_MS)).catch(
      () => undefined,
    );
    const raw = await withTimeout(page.evaluate(COLLECTOR_SCRIPT), timeLeft(SCRIPT_TIMEOUT_MS));

    const sanitized = sanitizeMeasurement(raw);
    if (sanitized === null) return { ok: false, reason: 'It returned no usable measurements' };
    if (sanitized.challenge) {
      return { ok: false, reason: 'It showed an anti-automation check instead of the site' };
    }
    if (sanitized.renderedElements < MIN_RENDERED_ELEMENTS) {
      return { ok: false, reason: 'It rendered almost nothing, likely blocking automation' };
    }
    return { ok: true, measurement: sanitized.measurement, truncated: budget.exhausted };
  } catch (error) {
    return { ok: false, reason: failureReason(error) };
  } finally {
    const opened = context;
    if (opened) await closeQuietly(() => opened.close(), 'browser context');
  }
}

export interface ReferenceTarget {
  url: string;
  origin: ReferenceOrigin;
}

const REFUSED_STATUSES = new Set([401, 403, 429, 503]);

/** One fetch before the browser: it resolves redirects and gives a precise failure reason. */
async function resolveEntry(
  transport: HopTransport,
  url: string,
): Promise<{ entry: string } | { reason: string }> {
  try {
    const response = await guardedFetch(transport, url, {
      headers: {
        'user-agent': DESKTOP_USER_AGENT,
        accept: 'text/html,application/xhtml+xml',
        'accept-encoding': 'gzip, deflate, br',
        'accept-language': 'en-US,en;q=0.9',
      },
      maxBytes: MAX_DOCUMENT_BYTES,
      timeoutMs: REQUEST_TIMEOUT_MS,
    });
    if (response.status >= 400) {
      const refused = REFUSED_STATUSES.has(response.status);
      return {
        reason: refused
          ? `It refused the automated visit (HTTP ${response.status})`
          : `It responded with HTTP ${response.status}`,
      };
    }
    if (!/text\/html|application\/xhtml/i.test(response.headers['content-type'] ?? '')) {
      return { reason: 'It did not return a web page' };
    }
    return { entry: response.finalUrl };
  } catch (error) {
    return { reason: failureReason(error) };
  }
}

async function analyzeOne(
  tools: RenderTools,
  target: ReferenceTarget,
  deadline: number,
): Promise<ReferenceAnalysis> {
  const failed = (reason: string): ReferenceAnalysis =>
    inaccessibleAnalysis(target.url, target.origin, reason);

  const resolved = await resolveEntry(tools.transport, target.url);
  if ('reason' in resolved) return failed(resolved.reason);

  const desktop = await renderViewport(tools, resolved.entry, DESKTOP, deadline);
  if (!desktop.ok) return failed(desktop.reason);

  const mobile = await renderViewport(tools, resolved.entry, MOBILE, deadline);
  const notes: string[] = [];
  if (!mobile.ok) notes.push(`Phone-width render failed: ${mobile.reason}.`);
  if (desktop.truncated || (mobile.ok && mobile.truncated)) {
    notes.push('Some assets were not loaded because the page exceeded a size limit.');
  }
  return measuredAnalysis(
    target.url,
    target.origin,
    { desktop: desktop.measurement, mobile: mobile.ok ? mobile.measurement : null },
    notes.length > 0 ? notes.join(' ') : null,
  );
}

export interface ReferenceAnalyzerDeps {
  launch?: BrowserLauncher;
  transport?: HopTransport;
  timeBudgetMs?: number;
  /** Can only lower the hard cap, never raise it. */
  limits?: { maxReferences?: number };
}

export interface ReferenceOutcome {
  analyses: ReferenceAnalysis[];
  limitations: string[];
}

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function summarize(analyses: readonly ReferenceAnalysis[], limitations: string[]): void {
  for (const analysis of analyses) {
    if (analysis.limitation === null) continue;
    limitations.push(
      analysis.accessible
        ? `Reference ${hostLabel(analysis.url)} was only partly measured. ${analysis.limitation}`
        : `Reference ${hostLabel(analysis.url)} was not measured. ${analysis.limitation}.`,
    );
  }
  const measured = analyses.filter((analysis) => analysis.accessible).length;
  if (analyses.length > 0 && measured === 0) {
    limitations.push(
      'No reference site could be measured, so visual direction rests on text evidence alone.',
    );
  } else if (measured === 1) {
    limitations.push(
      'Only one reference site could be measured, so visual direction draws on a single example.',
    );
  }
}

async function runAnalysis(
  targets: readonly ReferenceTarget[],
  deps: ReferenceAnalyzerDeps,
  budgetEnd: number,
): Promise<ReferenceOutcome> {
  const outOfTime = (target: ReferenceTarget): ReferenceAnalysis =>
    inaccessibleAnalysis(
      target.url,
      target.origin,
      'The time set aside for rendering references ran out first',
    );
  const cap = Math.min(
    Math.max(0, deps.limits?.maxReferences ?? MAX_REFERENCE_ANALYSES),
    MAX_REFERENCE_ANALYSES,
  );
  const accepted = targets.slice(0, cap);
  const limitations: string[] = [];
  if (targets.length > accepted.length) {
    limitations.push(`Only the first ${cap} of ${targets.length} reference sites were rendered.`);
  }

  const results = new Map<ReferenceTarget, ReferenceAnalysis>();
  const renderable: ReferenceTarget[] = [];
  for (const target of accepted) {
    if (isSafeResearchUrl(target.url)) {
      renderable.push(target);
    } else {
      // The host only: the refused URL may itself hold a credential.
      results.set(
        target,
        inaccessibleAnalysis(
          describeRejectedUrl(target.url),
          target.origin,
          'It was refused as unsafe to load',
        ),
      );
    }
  }

  if (renderable.length > 0 && Date.now() >= budgetEnd) {
    // Nothing could finish, so no browser is started just to be closed again.
    for (const target of renderable) results.set(target, outOfTime(target));
  } else if (renderable.length > 0) {
    let browser: BrowserLike | undefined;
    let unavailable: string | undefined;
    try {
      browser = await (deps.launch ?? launchChromium)();
    } catch (error) {
      unavailable =
        error instanceof BrowserUnavailableError ? error.message : 'A browser could not be started';
    }

    if (browser === undefined) {
      // An environment without a browser is normal, so research carries on.
      const reason = `Reference rendering is unavailable here: ${unavailable ?? 'no browser'}`;
      limitations.push(`${reason}, so reference sites were not measured.`);
      for (const target of renderable) {
        results.set(target, inaccessibleAnalysis(target.url, target.origin, reason));
      }
    } else {
      const running = browser;
      const network: NodeTransport =
        deps.transport === undefined
          ? createNodeTransport()
          : { transport: deps.transport, close: () => undefined };
      const tools: RenderTools = { browser: running, transport: network.transport };
      try {
        for (const target of renderable) {
          if (Date.now() >= budgetEnd) {
            results.set(target, outOfTime(target));
            continue;
          }
          const deadline = Math.min(budgetEnd, Date.now() + REFERENCE_DEADLINE_MS);
          results.set(target, await analyzeOne(tools, target, deadline));
        }
      } finally {
        await closeQuietly(() => running.close(), 'browser');
        network.close();
      }
    }
  }

  const analyses = accepted.flatMap((target) => {
    const analysis = results.get(target);
    return analysis ? [analysis] : [];
  });
  summarize(analyses, limitations);
  return { analyses, limitations };
}

/** Never rejects: a failed reference is recorded in its analysis, and research continues. */
export async function analyzeReferences(
  targets: readonly ReferenceTarget[],
  deps: ReferenceAnalyzerDeps = {},
): Promise<ReferenceOutcome> {
  if (targets.length === 0) return { analyses: [], limitations: [] };
  // Fixed before queueing: time spent behind another build's render is still this build's time.
  const budgetEnd = Date.now() + (deps.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS);
  try {
    return await oneAtATime(() => runAnalysis(targets, deps, budgetEnd));
  } catch (error) {
    logger.warn('Reference analysis failed unexpectedly', {
      reason: error instanceof Error ? error.message : String(error),
    });
    return { analyses: [], limitations: ['Reference analysis stopped on an internal error.'] };
  }
}

/** Articles and listicles rank well in search but say nothing about how a real site looks. */
const ARTICLE_PATH =
  /(^|[/-])(blog|article|articles|news|guide|guides|review|reviews|best|top-\d+|how-to|list|inspiration|examples?)([/-]|$)/i;

function looksLikeSitePage(url: string): boolean {
  const { pathname } = new URL(url);
  return pathname.split('/').filter(Boolean).length <= 2 && !ARTICLE_PATH.test(pathname);
}

/** User-supplied URLs first, then the strongest researched sites, one page per site. */
export function chooseReferences(
  userUrls: readonly string[],
  rankedUrls: readonly string[],
  cap: number = MAX_REFERENCE_ANALYSES,
): ReferenceTarget[] {
  const limit = Math.min(cap, MAX_REFERENCE_ANALYSES);
  const chosen: ReferenceTarget[] = [];
  const seen = new Set<string>();
  for (const url of userUrls) {
    const key = urlDedupeKey(url) ?? url;
    if (seen.has(key)) continue;
    seen.add(key);
    chosen.push({ url, origin: 'user' });
  }
  const hosts = new Set(chosen.map((target) => hostLabel(target.url)));
  for (const url of rankedUrls) {
    if (chosen.length >= limit) break;
    const key = urlDedupeKey(url);
    if (key === null || seen.has(key) || hosts.has(hostLabel(url)) || !looksLikeSitePage(url)) {
      continue;
    }
    seen.add(key);
    hosts.add(hostLabel(url));
    chosen.push({ url, origin: 'researched' });
  }
  return chosen;
}

/**
 * Measurements for the synthesis prompt, as anonymous entries. The model never
 * learns which site a measurement came from, so it cannot name it in a direction.
 */
export function buildReferenceEvidence(
  analyses: readonly ReferenceAnalysis[],
  maxChars: number,
): string | null {
  const entries: string[] = [];
  let used = 2;
  analyses
    .filter((analysis) => analysis.accessible && analysis.measurements !== undefined)
    .forEach((analysis, index) => {
      const entry = JSON.stringify({
        reference: `reference-${index + 1}`,
        suppliedByUser: analysis.origin === 'user',
        ...analysis.measurements,
      });
      if (used + entry.length + 1 > maxChars) return;
      entries.push(entry);
      used += entry.length + 1;
    });
  return entries.length === 0 ? null : `[${entries.join(',')}]`;
}

/** A direction that names a reference has copied something the output must not carry. */
export function withoutReferenceNames(
  lines: readonly string[],
  analyses: readonly ReferenceAnalysis[],
): { kept: string[]; dropped: number } {
  const names = analyses
    .map((analysis) => hostLabel(analysis.url).split('.')[0] ?? '')
    .filter((name) => name.length >= 5)
    .map((name) => new RegExp(`\\b${name.replace(/[^a-z0-9]/gi, '.?')}\\b`, 'i'));
  const kept = lines.filter((line) => !names.some((name) => name.test(line)));
  return { kept, dropped: lines.length - kept.length };
}
