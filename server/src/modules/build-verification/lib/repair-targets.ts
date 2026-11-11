/**
 * Which files a failure points at, read from the failure itself.
 *
 * Only paths that exist in the project can come out of here, so a path in a
 * log, or one a project printed to mislead, cannot widen what a repair may
 * edit beyond the generated files.
 */
import type {
  ProjectFile,
  VerificationResult,
  VerificationStep,
} from '../build-verification.types.js';

const MAX_TARGETS = 6;
const EVIDENCE_CAP = 12_000;
const STEP_OUTPUT_CAP = 3_500;

const PATH_IN_TEXT =
  /(?:^|[\s("'[])(\/?(?:[\w@.-]+\/)*[\w@.-]+\.(?:tsx?|jsx?|mjs|cjs|json|prisma|css))(?=$|[\s:()'",\]])/gm;
const MISSING_PACKAGE =
  /(?:Cannot find (?:module|package)|Failed to resolve import)\s+["']([^."'/][^"']*)["']/g;
const AREA_HEADER = /^(?:--- |\[)(backend|frontend)(?:\/ |\] )/;

function resolvePath(raw: string, area: string | null, paths: ReadonlySet<string>): string | null {
  const candidate = raw.replace(/^\.?\//, '');
  if (candidate.includes('node_modules/') || candidate.includes('..')) return null;
  if (paths.has(candidate)) return candidate;
  if (area !== null && paths.has(`${area}/${candidate}`)) return `${area}/${candidate}`;

  const bySuffix = [...paths].filter((path) => path.endsWith(`/${candidate}`));
  return bySuffix.length === 1 ? (bySuffix[0] ?? null) : null;
}

function isEditable(path: string): boolean {
  const base = path.split('/').pop() ?? '';
  return !base.startsWith('.env') && base !== 'package-lock.json';
}

function pathsIn(text: string, paths: ReadonlySet<string>, add: (path: string) => void): void {
  let area: string | null = null;
  for (const line of text.split('\n')) {
    area = AREA_HEADER.exec(line)?.[1] ?? area;
    for (const match of line.matchAll(PATH_IN_TEXT)) {
      const resolved = match[1] ? resolvePath(match[1], area, paths) : null;
      if (resolved) add(resolved);
    }
    for (const match of line.matchAll(MISSING_PACKAGE)) {
      if (match[1] && area && paths.has(`${area}/package.json`)) add(`${area}/package.json`);
    }
  }
}

function fallbackTargets(step: VerificationStep, paths: ReadonlySet<string>): string[] {
  if (step.id === 'install') {
    return ['backend/package.json', 'frontend/package.json'].filter((path) => paths.has(path));
  }
  if (step.id === 'start' || step.id === 'health') {
    return ['backend/src/index.ts', 'frontend/src/main.tsx'].filter((path) => paths.has(path));
  }
  return [];
}

/** Backend source named after the resource a failing route serves. */
function routeTargets(verification: VerificationResult, paths: ReadonlySet<string>): string[] {
  const found: string[] = [];
  for (const check of verification.routes) {
    if (check.status !== 'failed' || !check.path.startsWith('/api')) continue;
    const resource = check.path.split('/').filter(Boolean).pop()?.replace(/s$/, '').toLowerCase();
    if (!resource || resource === 'api') continue;
    const matches = [...paths].filter(
      (path) => path.startsWith('backend/src/') && path.toLowerCase().includes(resource),
    );
    found.push(...matches.slice(0, 3));
  }
  return found;
}

export function failedSteps(verification: VerificationResult): VerificationStep[] {
  return verification.steps.filter((step) => step.status === 'failed');
}

export function extractRepairTargets(
  verification: VerificationResult,
  files: readonly ProjectFile[],
): string[] {
  const paths = new Set(files.filter((file) => isEditable(file.path)).map((file) => file.path));
  const targets = new Set<string>();
  const add = (path: string): void => {
    if (targets.size < MAX_TARGETS) targets.add(path);
  };

  for (const step of failedSteps(verification)) {
    const before = targets.size;
    pathsIn(`${step.summary}\n${step.output}`, paths, add);
    if (targets.size === before) fallbackTargets(step, paths).forEach(add);
  }
  routeTargets(verification, paths).forEach(add);
  return [...targets];
}

/** Real failure output, bounded. Failures come first: they are the point. */
export function failureEvidence(verification: VerificationResult): string {
  const sections = failedSteps(verification).map(
    (step) => `CHECK ${step.id}: ${step.summary}\n${step.output.slice(-STEP_OUTPUT_CAP)}`,
  );
  const routes = verification.routes
    .filter((check) => check.status === 'failed')
    .map(
      (check) =>
        `ROUTE ${check.method} ${check.path}: expected ${String(check.expectedStatus ?? 'a working answer')}, got ${String(check.actualStatus ?? 'no answer')}. ${check.detail ?? ''}`,
    );
  return [...sections, ...routes].join('\n\n').slice(0, EVIDENCE_CAP);
}
