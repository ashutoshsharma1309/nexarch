/**
 * The HTTP half of verification: asking the running application.
 *
 * A status line alone is weak evidence, so each check looks past it where
 * more is available: the backend's health payload says whether it is
 * degraded, and a frontend is only "up" if the modules its document loads
 * can be served, which is where a broken import shows up on a dev server.
 */
import type { DeclaredRoute, RouteCheck } from '../build-verification.types.js';

export type Fetcher = typeof fetch;

const PROBE_TIMEOUT_MS = 10_000;
const MAX_ROUTES = 40;
const MAX_ENTRY_MODULES = 5;

interface Probe {
  status: number | null;
  contentType: string;
  body: string;
  error: string | null;
}

async function probe(
  fetcher: Fetcher,
  url: string,
  signal: AbortSignal,
  init: RequestInit = {},
): Promise<Probe> {
  try {
    const response = await fetcher(url, {
      ...init,
      redirect: 'manual',
      signal: AbortSignal.any([signal, AbortSignal.timeout(PROBE_TIMEOUT_MS)]),
    });
    return {
      status: response.status,
      contentType: response.headers.get('content-type') ?? '',
      body: (await response.text()).slice(0, 20_000),
      error: null,
    };
  } catch (error) {
    return {
      status: null,
      contentType: '',
      body: '',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export interface HealthOutcome {
  ok: boolean;
  summary: string;
  detail: string;
  /** The backend said its database is down. */
  degraded: boolean;
}

export async function checkBackendHealth(
  fetcher: Fetcher,
  baseUrl: string,
  signal: AbortSignal,
): Promise<HealthOutcome> {
  const path = '/api/v1/health';
  const result = await probe(fetcher, `${baseUrl}${path}`, signal);
  if (result.status === null) {
    return {
      ok: false,
      degraded: false,
      summary: `Backend health did not answer: ${result.error ?? 'no response'}`,
      detail: result.error ?? '',
    };
  }
  if (result.status < 200 || result.status >= 300) {
    return {
      ok: false,
      degraded: false,
      summary: `Backend health answered ${String(result.status)}`,
      detail: result.body.slice(0, 500),
    };
  }

  let degraded = false;
  try {
    const parsed = JSON.parse(result.body) as { data?: { status?: unknown } };
    degraded = parsed.data?.status === 'degraded';
  } catch {
    // A 2xx that is not JSON still answered; there is just no payload to read.
  }
  return {
    ok: true,
    degraded,
    summary: degraded
      ? `Backend health answered ${String(result.status)} but reports degraded`
      : `Backend health answered ${String(result.status)}`,
    detail: result.body.slice(0, 500),
  };
}

/** Same-origin module scripts in a document, which a dev server compiles on request. */
export function entryModules(html: string): string[] {
  const found: string[] = [];
  for (const match of html.matchAll(/<script[^>]*\stype=["']module["'][^>]*>/gi)) {
    const src = /\ssrc=["']([^"']+)["']/i.exec(match[0])?.[1];
    if (src?.startsWith('/') === true && !src.startsWith('//')) found.push(src);
  }
  return found.slice(0, MAX_ENTRY_MODULES);
}

export async function checkFrontend(
  fetcher: Fetcher,
  baseUrl: string,
  signal: AbortSignal,
): Promise<HealthOutcome> {
  const document = await probe(fetcher, `${baseUrl}/`, signal);
  if (document.status === null || document.status < 200 || document.status >= 300) {
    return {
      ok: false,
      degraded: false,
      summary: `Frontend root answered ${String(document.status ?? 'nothing')}`,
      detail: document.error ?? document.body.slice(0, 500),
    };
  }
  if (!document.contentType.includes('html')) {
    return {
      ok: false,
      degraded: false,
      summary: `Frontend root answered ${document.contentType || 'no content type'}, not HTML`,
      detail: document.body.slice(0, 500),
    };
  }

  const modules = entryModules(document.body);
  for (const module of modules) {
    const loaded = await probe(fetcher, `${baseUrl}${module}`, signal);
    if (loaded.status === null || loaded.status < 200 || loaded.status >= 300) {
      return {
        ok: false,
        degraded: false,
        summary: `Frontend module ${module} answered ${String(loaded.status ?? 'nothing')}`,
        detail: loaded.error ?? loaded.body.slice(0, 2_000),
      };
    }
  }
  return {
    ok: true,
    degraded: false,
    summary: `Frontend served its document and ${String(modules.length)} entry module(s)`,
    detail: '',
  };
}

export interface RouteTargets {
  backend: string | null;
  frontend: string | null;
}

function baseFor(path: string, targets: RouteTargets): string | null {
  if (path === '/api' || path.startsWith('/api/')) return targets.backend;
  return targets.frontend ?? targets.backend;
}

/** Page and API paths a project declares in its own source, GET only. */
export function discoverFrontendPages(
  files: readonly { path: string; content: string }[],
): string[] {
  const pages = new Set<string>();
  for (const file of files) {
    if (!file.path.startsWith('frontend/src/') || !/\.(?:tsx|jsx|ts|js)$/.test(file.path)) continue;
    for (const match of file.content.matchAll(/\bpath\s*[:=]\s*\{?\s*["'`](\/[^"'`]*)["'`]/g)) {
      const path = match[1];
      if (path) pages.add(path);
    }
  }
  return [...pages];
}

export function withoutParameters(path: string): boolean {
  return !path.includes(':') && !path.includes('*');
}

function expectationMet(route: DeclaredRoute, actual: number): boolean {
  if (route.expectedStatus !== undefined) return actual === route.expectedStatus;
  // Nothing declared: the route must exist and not crash. 401 and 400 are a
  // real answer from a real handler that wanted a login or a body.
  return actual < 500 && actual !== 404;
}

export async function checkRoutes(
  fetcher: Fetcher,
  routes: readonly DeclaredRoute[],
  targets: RouteTargets,
  signal: AbortSignal,
): Promise<RouteCheck[]> {
  const checks: RouteCheck[] = [];
  for (const route of routes.slice(0, MAX_ROUTES)) {
    const method = route.method.toUpperCase();
    const expectedStatus = route.expectedStatus ?? null;
    const base = baseFor(route.path, targets);
    if (base === null) {
      checks.push({
        method,
        path: route.path,
        expectedStatus,
        actualStatus: null,
        status: 'blocked',
        detail: 'No running process serves this path',
      });
      continue;
    }

    const hasBody = !['GET', 'HEAD', 'DELETE'].includes(method);
    const result = await probe(fetcher, `${base}${route.path}`, signal, {
      method,
      ...(hasBody ? { body: '{}', headers: { 'content-type': 'application/json' } } : {}),
    });
    const passed = result.status !== null && expectationMet(route, result.status);
    checks.push({
      method,
      path: route.path,
      expectedStatus,
      actualStatus: result.status,
      status: passed ? 'passed' : 'failed',
      detail: passed ? null : (result.error ?? result.body.slice(0, 1_000)),
    });
  }
  return checks;
}
