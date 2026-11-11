/**
 * What a capability has to really touch before it can be called added.
 *
 * "Added authentication" that changed one route file is not authentication,
 * and a model will happily report that it is. So the areas are fixed here,
 * checked against the plan before anything runs and against the real diff
 * before the result is accepted.
 */
import type { CoverageArea, EnhancementKind, FunctionalCheckSpec } from '../enhancement.types.js';

interface AreaRule {
  area: string;
  label: string;
  pattern: RegExp;
  /** A file already in the project covers this area without being changed. */
  reusable?: boolean;
}

const ROUTES: AreaRule = {
  area: 'routes',
  label: 'Backend routes',
  pattern: /^backend\/.*(route|router|controller)[^/]*\.[jt]s$/i,
};
const SCHEMA: AreaRule = {
  area: 'schema',
  label: 'Database schema',
  pattern: /(schema\.prisma$|\/migrations\/.+\.sql$|\/schema\.sql$)/i,
};
const PERSISTENCE: AreaRule = {
  area: 'persistence',
  label: 'Persistence code',
  pattern: /^backend\/.*(repositor|service|store|model|dao|prisma)[^/]*\.[jt]s$/i,
};
const FRONTEND_FORMS: AreaRule = {
  area: 'frontend-forms',
  label: 'Frontend sign-in and registration forms',
  pattern: /^frontend\/.*(login|register|sign-?in|sign-?up|auth)[^/]*\.[jt]sx$/i,
};
const SESSION: AreaRule = {
  area: 'session',
  label: 'Frontend session handling',
  pattern: /^frontend\/.*(auth|session|token|api-?client|axios|http)[^/]*\.[jt]sx?$/i,
};
const ENV: AreaRule = {
  area: 'env',
  label: 'Environment configuration',
  pattern: /(^|\/)(\.env\.example|config[^/]*\.[jt]s|env[^/]*\.[jt]s)$/i,
};

const FRONTEND_API: AreaRule = {
  area: 'frontend-api',
  label: 'Frontend connected to the API',
  pattern:
    /^frontend\/.*(\/(services?|hooks|api)\/[^/]+|(service|api-?client|use-[^/]*))\.[jt]sx?$/i,
};

const REQUIRED: Partial<Record<EnhancementKind, readonly AreaRule[]>> = {
  'add-authentication': [ROUTES, SCHEMA, PERSISTENCE, FRONTEND_FORMS, SESSION, ENV],
  'add-database': [SCHEMA, PERSISTENCE, ROUTES, ENV],
  // An app that already has a schema can reuse it, but routes, persistence and
  // a frontend that calls them are what "a backend" means for this request.
  'add-backend': [ROUTES, PERSISTENCE, { ...SCHEMA, reusable: true }, FRONTEND_API],
};

/**
 * Kinds whose areas must really change. Every generated app already has route
 * and service files, stubs included, so "already present" would let a plan that
 * changes one file count as having added a backend.
 */
const MUST_CHANGE: readonly EnhancementKind[] = ['add-backend'];

/**
 * Whether the project already has every area of this capability.
 *
 * Generated apps often ship with auth and a schema, so "add authentication" to
 * one is an extension and need not rewrite all six areas. The live round trip
 * is still required, and that is what proves the capability works.
 */
export function capabilityAlreadyPresent(
  kind: EnhancementKind,
  baseline: readonly string[],
): boolean {
  const rules = REQUIRED[kind] ?? [];
  return (
    !MUST_CHANGE.includes(kind) &&
    rules.length > 0 &&
    rules.every((rule) => baseline.some((path) => rule.pattern.test(path)))
  );
}

export function evaluateCoverage(
  kind: EnhancementKind,
  paths: readonly string[],
  baseline: readonly string[] = [],
): CoverageArea[] {
  const present = capabilityAlreadyPresent(kind, baseline);
  return (REQUIRED[kind] ?? []).map((rule) => {
    const matching = paths.filter((path) => rule.pattern.test(path));
    const reused = rule.reusable === true && baseline.some((path) => rule.pattern.test(path));
    return {
      area: rule.area,
      label: rule.label,
      satisfied: matching.length > 0 || present || reused,
      paths: matching.slice(0, 20),
      ...(matching.length === 0 && (present || reused) ? { alreadyPresent: true } : {}),
    };
  });
}

export function missingAreas(coverage: readonly CoverageArea[]): CoverageArea[] {
  return coverage.filter((area) => !area.satisfied);
}

/**
 * Kinds with no live round trip of their own: compiling and starting says
 * nothing about whether the new backend, module or integration does anything.
 */
export function capabilityGoesUntested(
  kind: EnhancementKind,
  functionalChecksRan: number,
): boolean {
  return (
    functionalChecksRan === 0 &&
    (kind === 'add-backend' || kind === 'add-module' || kind === 'integrate-api')
  );
}

/** Whether a kind requires a live register/login or CRUD round trip to count. */
export function requiresFunctionalCheck(kind: EnhancementKind): 'auth' | 'crud' | null {
  if (kind === 'add-authentication') return 'auth';
  if (kind === 'add-database' || kind === 'add-backend') return 'crud';
  return null;
}

/**
 * Whether the frontend really calls the backend this change added.
 *
 * A file named like an API client proves nothing: the check is that a changed
 * frontend file names the resource path the live round trip used. Returns the
 * reason it does not, or null. Only `add-backend` promises a connected frontend.
 */
export function disconnectedFrontendReason(
  kind: EnhancementKind,
  checks: readonly FunctionalCheckSpec[],
  changedFrontend: readonly { path: string; content: string }[],
): string | null {
  if (kind !== 'add-backend') return null;
  for (const check of checks) {
    if (check.kind !== 'crud') continue;
    const segment = check.collectionPath
      .split('/')
      .filter((part) => part !== '' && !part.startsWith(':'))
      .at(-1);
    if (segment === undefined) continue;
    const reference = `/${segment}`;
    if (!changedFrontend.some((file) => file.content.includes(reference))) {
      return `The backend for ${check.collectionPath} was added, but no frontend file that changed calls it.`;
    }
  }
  return null;
}
