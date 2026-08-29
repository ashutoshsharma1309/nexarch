/**
 * What the project declares it needs, against what it actually uses.
 *
 * Every check is deterministic and reads two things: the package manifest
 * and the import statements in the source. That is enough to answer most
 * of what Step 10 asks, and it is enough *reliably*, which matters more —
 * a dependency report that cries wolf gets muted, and then the one real
 * finding in it is missed too.
 *
 * The import scanner handles four forms, and the fourth is why this is a
 * scanner rather than a one-line regex:
 *
 *   import x from 'pkg'      — the obvious one
 *   import('pkg')            — dynamic
 *   require('pkg')           — CommonJS
 *   import 'pkg'             — side effect only, no binding
 *
 * A first version of this missed the last form and reported `dotenv` as
 * unused on a project whose config file opens with `import 'dotenv/config'`.
 * That is the exact shape of a false positive Step 7 warns about: a
 * confident, specific, wrong finding about a dependency that is load-bearing.
 *
 * Package-manager tooling is deliberately *not* invoked. `npm audit` needs
 * a lockfile and network access to a vulnerability database, and the
 * generated project has neither at review time. Rather than invent CVE
 * data, the report says plainly that vulnerability verification did not run.
 */
import type { AgentFinding } from '../../../shared/contracts/index.js';

export interface ManifestFile {
  path: string;
  content: string;
}

export interface PackageManifest {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export interface DependencyArea {
  /** `backend` or `frontend` — the boundary a package must not cross. */
  area: string;
  manifest: PackageManifest;
  files: readonly ManifestFile[];
  /** True when a lockfile was present alongside the manifest. */
  hasLockfile: boolean;
}

/** Node's own modules are always available and never declared. */
const BUILTIN =
  /^(?:node:|assert|buffer|child_process|cluster|crypto|dns|events|fs|http|https|net|os|path|perf_hooks|process|querystring|readline|stream|string_decoder|timers|tls|url|util|worker_threads|zlib)(?:\/|$)/;

/** Packages used by tooling rather than imported: they appear in scripts. */
const SOURCE_EXTENSIONS = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;

/**
 * The package a specifier belongs to.
 *
 * `@scope/name/sub` → `@scope/name`; `pkg/sub` → `pkg`. Relative and alias
 * specifiers resolve to nothing.
 */
function packageOf(specifier: string): string | null {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('@/')) {
    return null;
  }
  /*
   * Any `node:` specifier is a builtin regardless of what follows the
   * prefix. The regex alone got this wrong: it expected `/` or the end
   * after the prefix, so `node:http` fell through and was reported as an
   * undeclared package named "node:http" — a finding about a module that
   * ships inside Node itself.
   */
  if (specifier.startsWith('node:')) return null;
  if (BUILTIN.test(specifier)) return null;
  const parts = specifier.split('/');
  if (specifier.startsWith('@')) {
    return parts.length >= 2 ? `${parts[0] ?? ''}/${parts[1] ?? ''}` : null;
  }
  return parts[0] ?? null;
}

/** Every package the source imports, in any of the four forms. */
export function importedPackages(files: readonly ManifestFile[]): Set<string> {
  const used = new Set<string>();
  const patterns = [
    /\bfrom\s+['"]([^'"]+)['"]/g, // import x from 'pkg'
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, // import('pkg')
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g, // require('pkg')
    /\bimport\s+['"]([^'"]+)['"]/g, // import 'pkg'  ← the one that bit us
  ];

  for (const file of files) {
    if (!SOURCE_EXTENSIONS.test(file.path)) continue;
    for (const pattern of patterns) {
      for (const match of file.content.matchAll(pattern)) {
        const name = packageOf(match[1] ?? '');
        if (name) used.add(name);
      }
    }
  }
  return used;
}

/** Packages named by npm scripts — used, but never imported. */
function scriptPackages(manifest: PackageManifest): Set<string> {
  const used = new Set<string>();
  for (const command of Object.values(manifest.scripts ?? {})) {
    for (const token of command.split(/[\s|&><]+/)) {
      const name = packageOf(token.replace(/^npx\s+/, ''));
      if (name && !name.startsWith('-')) used.add(name);
    }
  }
  return used;
}

/**
 * Packages whose presence is required by a config or a plugin rather than
 * an import — a build tool loading them by name from a config file.
 */
const IMPLICITLY_USED = new Set([
  'typescript',
  'prisma',
  '@prisma/client',
  'tailwindcss',
  '@tailwindcss/vite',
  'autoprefixer',
  'postcss',
  'eslint',
  'globals',
]);

function findingFor(
  area: string,
  severity: AgentFinding['severity'],
  category: string,
  title: string,
  description: string,
  evidence: string,
  recommendation: string,
  confidence: number,
): AgentFinding {
  return {
    type: 'DEPENDENCY',
    severity,
    category,
    title,
    description,
    evidence,
    recommendation,
    targetNodeId: null,
    targetFile: `${area}/package.json`,
    confidence,
    status: 'OPEN',
  };
}

function reviewArea(input: DependencyArea): AgentFinding[] {
  const findings: AgentFinding[] = [];
  const { area, manifest } = input;

  const dependencies = manifest.dependencies ?? {};
  const devDependencies = manifest.devDependencies ?? {};
  const imported = importedPackages(input.files);
  const scripts = scriptPackages(manifest);

  /* Unused production dependencies. */
  for (const name of Object.keys(dependencies)) {
    if (imported.has(name) || scripts.has(name) || IMPLICITLY_USED.has(name)) continue;
    findings.push(
      findingFor(
        area,
        'LOW',
        'UNUSED_DEPENDENCY',
        `Unused dependency "${name}"`,
        `${name}@${dependencies[name] ?? ''} is declared in ${area}/package.json but nothing imports it and no script invokes it.`,
        `${area}/package.json — dependencies.${name}`,
        `Remove ${name}, or use it. Every unused dependency is install time, disk, and attack surface for nothing.`,
        // A package can still be loaded by a config this cannot read.
        0.75,
      ),
    );
  }

  /* Imported but never declared — the failure that breaks a fresh install. */
  for (const name of imported) {
    if (name in dependencies || name in devDependencies) continue;
    findings.push(
      findingFor(
        area,
        'HIGH',
        'MISSING_DEPENDENCY',
        `Undeclared dependency "${name}"`,
        `${area} source imports ${name}, which appears in neither dependencies nor devDependencies. This builds locally only while the package happens to be hoisted from elsewhere; a clean install fails.`,
        `imported by ${area} source, absent from ${area}/package.json`,
        `Add ${name} to ${area}/package.json.`,
        0.95,
      ),
    );
  }

  /*
   * A runtime import satisfied only by a dev dependency.
   *
   * "Runtime" excludes more than `*.test.*`: files under a tests directory
   * and tool configuration (`eslint.config.js`, `vite.config.ts`, …) run
   * under the tooling, never in production. Before these exclusions the
   * check reported `jest` — imported only by generated test scaffolds —
   * as a runtime dependency, which is exactly backwards.
   */
  const runtimeFiles = input.files.filter(
    (file) =>
      SOURCE_EXTENSIONS.test(file.path) &&
      !/\.(?:test|spec)\./.test(file.path) &&
      !/(?:^|\/)(?:tests?|__tests__)\//.test(file.path) &&
      !/\.config\.[cm]?[jt]s$/.test(file.path) &&
      !/(?:^|\/)(?:jest|vitest)\.setup\./.test(file.path),
  );
  const runtimeImports = importedPackages(runtimeFiles);
  for (const name of runtimeImports) {
    if (!(name in devDependencies) || name in dependencies) continue;
    if (IMPLICITLY_USED.has(name)) continue;
    if (name.startsWith('@types/')) continue;
    findings.push(
      findingFor(
        area,
        'MEDIUM',
        'DEV_DEPENDENCY_AT_RUNTIME',
        `Runtime code imports the dev dependency "${name}"`,
        `${name} is declared under devDependencies but imported by runtime source in ${area}. A production install omits devDependencies and this import will fail at start-up.`,
        `${area}/package.json — devDependencies.${name}`,
        `Move ${name} into dependencies.`,
        0.85,
      ),
    );
  }

  /* Declared in both blocks — the version that wins is install-order luck. */
  for (const name of Object.keys(dependencies)) {
    if (!(name in devDependencies)) continue;
    findings.push(
      findingFor(
        area,
        'MEDIUM',
        'DUPLICATE_DEPENDENCY',
        `"${name}" is declared twice`,
        `${name} appears in both dependencies (${dependencies[name] ?? ''}) and devDependencies (${devDependencies[name] ?? ''}) of ${area}/package.json.`,
        `${area}/package.json — dependencies.${name} and devDependencies.${name}`,
        `Keep the declaration in one block only.`,
        1,
      ),
    );
  }

  return findings;
}

/**
 * Packages that belong to one side of the stack appearing on the other.
 *
 * A frontend that imports Prisma is not a style problem: it means database
 * credentials would have to reach the browser bundle for it to work.
 */
const BACKEND_ONLY = new Set([
  '@prisma/client',
  'prisma',
  'express',
  'bcrypt',
  'bcryptjs',
  'jsonwebtoken',
]);
const FRONTEND_ONLY = new Set(['react', 'react-dom', 'react-router-dom', 'vite']);

function reviewBoundaries(areas: readonly DependencyArea[]): AgentFinding[] {
  const findings: AgentFinding[] = [];

  for (const input of areas) {
    const declared = Object.keys(input.manifest.dependencies ?? {});
    const forbidden = input.area === 'frontend' ? BACKEND_ONLY : FRONTEND_ONLY;
    const crossing = declared.filter((name) => forbidden.has(name));
    if (crossing.length === 0) continue;

    findings.push(
      findingFor(
        input.area,
        input.area === 'frontend' ? 'HIGH' : 'MEDIUM',
        'BOUNDARY_VIOLATION',
        `${input.area} depends on ${crossing.join(', ')}`,
        input.area === 'frontend'
          ? `${crossing.join(', ')} are server-side packages. Reaching a database or signing a token from the browser requires shipping the credentials to it.`
          : `${crossing.join(', ')} are browser packages appearing in a server manifest.`,
        `${input.area}/package.json — ${crossing.join(', ')}`,
        `Move this work behind an API call and drop the dependency.`,
        0.9,
      ),
    );
  }

  return findings;
}

/** Version ranges that disagree for the same package across areas. */
function reviewVersionDrift(areas: readonly DependencyArea[]): AgentFinding[] {
  const seen = new Map<string, { area: string; range: string }[]>();

  for (const input of areas) {
    const all = {
      ...(input.manifest.dependencies ?? {}),
      ...(input.manifest.devDependencies ?? {}),
    };
    for (const [name, range] of Object.entries(all)) {
      seen.set(name, [...(seen.get(name) ?? []), { area: input.area, range }]);
    }
  }

  const findings: AgentFinding[] = [];
  for (const [name, entries] of seen) {
    const ranges = new Set(entries.map((entry) => entry.range));
    if (ranges.size < 2) continue;
    findings.push(
      findingFor(
        entries[0]?.area ?? 'project',
        'LOW',
        'VERSION_DRIFT',
        `"${name}" is pinned to different ranges across the project`,
        `${entries.map((entry) => `${entry.area}: ${entry.range}`).join(', ')}. Divergent ranges for a shared package produce two copies and, for anything with module-level state, two behaviours.`,
        entries.map((entry) => `${entry.area}/package.json — ${name}@${entry.range}`).join(' · '),
        `Align ${name} on one range.`,
        0.8,
      ),
    );
  }
  return findings;
}

export interface DependencyReview {
  findings: AgentFinding[];
  areas: {
    area: string;
    dependencies: number;
    devDependencies: number;
    imported: number;
    hasLockfile: boolean;
  }[];
  /**
   * Whether known-vulnerability data was consulted. Always false here, and
   * stated rather than omitted: a report silent about this reads as
   * "nothing vulnerable found", which is a claim this never makes.
   */
  vulnerabilityScan: {
    performed: false;
    reason: string;
  };
}

export function reviewDependencies(areas: readonly DependencyArea[]): DependencyReview {
  const withLockfiles = areas.filter((area) => area.hasLockfile);
  const reason =
    'No lockfile is generated with the project and no vulnerability database is reachable from the review, so npm audit was not run. Known-CVE status is unverified — not clear.';

  const findings = [
    ...areas.flatMap(reviewArea),
    ...reviewBoundaries(areas),
    ...reviewVersionDrift(areas),
    /*
     * Said out loud, at INFO, in the review itself rather than bolted on
     * by the agent: a dependency report silent about known CVEs reads as
     * "none found", which is a claim this review never makes.
     */
    {
      type: 'DEPENDENCY' as const,
      severity: 'INFO' as const,
      category: 'VULNERABILITY_SCAN',
      title: 'Known-vulnerability check did not run',
      description: reason,
      evidence: `lockfiles present: ${withLockfiles.length === 0 ? 'none' : withLockfiles.map((area) => area.area).join(', ')}`,
      recommendation:
        'Run `npm audit` after installing the generated project to check its dependencies against the advisory database.',
      targetNodeId: null,
      targetFile: null,
      confidence: 1,
      status: 'OPEN' as const,
    },
  ];

  return {
    findings,
    areas: areas.map((input) => ({
      area: input.area,
      dependencies: Object.keys(input.manifest.dependencies ?? {}).length,
      devDependencies: Object.keys(input.manifest.devDependencies ?? {}).length,
      imported: importedPackages(input.files).size,
      hasLockfile: input.hasLockfile,
    })),
    vulnerabilityScan: { performed: false, reason },
  };
}
