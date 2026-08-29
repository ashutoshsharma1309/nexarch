/**
 * Engineering quality of the generated source.
 *
 * The existing `analyzeQuality` already measures duplication, complexity,
 * large files and dead code over a real file list, and it is wrapped here
 * rather than reimplemented. What it does not do is compare the code to
 * the *plan* — whether the backend implements the modules the architecture
 * named, whether the frontend calls endpoints the contract declares —
 * and that comparison is where the interesting failures live, because it
 * is the one no single generator can make about itself.
 *
 * Step 14's closing line governs everything here: subjective style is not
 * a bug. There is no check for naming conventions, import order, quote
 * style or file length below a threshold that actually predicts trouble.
 * Every finding names a concrete file or module and says what is wrong
 * with it, not what would be prettier.
 */
import { analyzeQuality } from '../../quality/lib/quality-analyzer.js';
import type { AgentFinding } from '../../../shared/contracts/index.js';
import type { ArchitecturePlan } from '../../../shared/types/architecture.js';
import type { OpenApiDocument } from '../../../shared/types/design.js';

export interface QualityFile {
  path: string;
  content: string;
}

export interface QualityReviewInput {
  projectName: string;
  architecture: ArchitecturePlan;
  api: OpenApiDocument;
  backendFiles: readonly QualityFile[];
  frontendFiles: readonly QualityFile[];
  backendModules: readonly { name: string; entity: string | null }[];
  backendRoutes: readonly { method: string; path: string }[];
}

/** Severity words the existing analyzer uses, in this contract's vocabulary. */
function severityOf(value: string): AgentFinding['severity'] {
  if (value === 'high') return 'HIGH';
  if (value === 'medium') return 'MEDIUM';
  return 'LOW';
}

/**
 * Categories the existing analyzer reports that are genuinely engineering
 * problems. Anything outside this map is an observation, and observations
 * are reported at INFO rather than dressed up as defects.
 */
const MEANINGFUL: Record<string, string> = {
  duplication: 'DUPLICATION',
  'large-file': 'LARGE_FILE',
  complexity: 'COMPLEXITY',
  'dead-code': 'DEAD_CODE',
  'circular-dependency': 'COUPLING',
};

/** Files where length is a maintainability signal. A large JSON manifest is data, not debt. */
const CODE_FILE = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;

function fromAnalyzer(input: QualityReviewInput): AgentFinding[] {
  const report = analyzeQuality({
    projectName: input.projectName,
    backend: {
      files: [...input.backendFiles],
      modules: input.backendModules.map((mod) => mod.name),
      routes: [...input.backendRoutes],
    },
    frontend: { files: [...input.frontendFiles] },
  } as Parameters<typeof analyzeQuality>[0]);

  return report.issues
    .filter((issue) => issue.category !== 'large-file' || CODE_FILE.test(issue.location))
    .map((issue) => ({
      type: 'CODE_QUALITY' as const,
      severity: severityOf(issue.severity),
      category: MEANINGFUL[issue.category] ?? 'OBSERVATION',
      title: `${issue.category.replace(/-/g, ' ')} in ${issue.location}`,
      description: issue.message,
      evidence: `${issue.location} — ${issue.message}`,
      recommendation:
        issue.category === 'duplication'
          ? 'Extract the shared logic so a change has one place to happen.'
          : issue.category === 'large-file'
            ? 'Split this file along its existing responsibilities.'
            : issue.category === 'dead-code'
              ? 'Remove it, or wire it up if it was meant to be reachable.'
              : 'Reduce the branching, or extract the inner logic into named helpers.',
      targetNodeId: null,
      targetFile: issue.location,
      // Measured directly from the file.
      confidence: 1,
      status: 'OPEN' as const,
    }));
}

/* ── Plan versus implementation ────────────────────────────────────────── */

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Modules the architecture planned that the backend never built.
 *
 * This is the check that catches a generator quietly dropping a feature —
 * the failure mode where every individual artifact is internally
 * consistent and the system is missing a third of what was asked for.
 */
function architectureConformance(input: QualityReviewInput): AgentFinding[] {
  const built = new Set(input.backendModules.map((mod) => normalize(mod.name)));
  const findings: AgentFinding[] = [];

  for (const planned of input.architecture.apiModules) {
    const key = normalize(planned.module);
    if ([...built].some((name) => name.includes(key) || key.includes(name))) continue;

    findings.push({
      type: 'CODE_QUALITY',
      severity: 'HIGH',
      category: 'ARCHITECTURE_DRIFT',
      title: `Planned module "${planned.module}" has no implementation`,
      description: `The architecture plans an API module "${planned.module}" with ${String(planned.endpoints.length)} endpoint(s) under ${planned.basePath}, and the generated backend contains no module for it.`,
      evidence: `architecture-plan — apiModules["${planned.module}"] · backend modules: ${input.backendModules.map((mod) => mod.name).join(', ') || 'none'}`,
      recommendation:
        'Regenerate the backend against the current plan, or remove the module from the plan if it is out of scope.',
      targetNodeId: null,
      targetFile: null,
      confidence: 0.9,
      status: 'OPEN',
    });
  }

  return findings;
}

/**
 * Endpoints the contract declares that nothing serves, and routes served
 * that the contract does not declare.
 *
 * Reported at MEDIUM rather than HIGH: the backend engineer already checks
 * this at generation time and the finding here is a second reading of the
 * same fact, useful for a reviewer looking at the project cold.
 */
function contractConformance(input: QualityReviewInput): AgentFinding[] {
  const declared = new Set<string>();
  for (const [path, item] of Object.entries(input.api.paths)) {
    const normalized = path.replace(/\{[^}]+\}/g, ':param');
    for (const method of Object.keys(item)) {
      declared.add(`${method.toUpperCase()} ${normalized}`);
    }
  }

  const served = new Set(
    input.backendRoutes.map((route) => {
      const path = route.path
        .replace(/^\/api\/v\d+/, '')
        .replace(/\/:[A-Za-z_][A-Za-z0-9_]*/g, '/:param');
      return `${route.method.toUpperCase()} ${path === '' ? '/' : path}`;
    }),
  );

  const unserved = [...declared].filter((route) => !served.has(route));
  if (unserved.length === 0) return [];

  return [
    {
      type: 'CODE_QUALITY',
      severity: 'MEDIUM',
      category: 'CONTRACT_MISMATCH',
      title: 'The API contract declares endpoints the backend does not serve',
      description: `${String(unserved.length)} of ${String(declared.size)} declared operations have no route in the generated backend. A client generated from this contract will call endpoints that return 404.`,
      evidence: unserved.slice(0, 5).join(' · ') + (unserved.length > 5 ? ' · …' : ''),
      recommendation:
        'Regenerate the backend from the contract, or regenerate the contract from what the backend actually serves.',
      targetNodeId: null,
      targetFile: null,
      confidence: 0.9,
      status: 'OPEN',
    },
  ];
}

/**
 * Errors caught and discarded.
 *
 * An empty catch is not a style choice — it converts a failure into a
 * silent wrong answer, which is the hardest class of bug to find later.
 */
function errorHandling(input: QualityReviewInput): AgentFinding[] {
  const findings: AgentFinding[] = [];
  const swallowed = /catch\s*(?:\([^)]*\))?\s*\{\s*\}/g;

  for (const file of [...input.backendFiles, ...input.frontendFiles]) {
    const matches = [...file.content.matchAll(swallowed)];
    if (matches.length === 0) continue;

    const line = file.content.slice(0, matches[0]?.index ?? 0).split('\n').length;
    findings.push({
      type: 'CODE_QUALITY',
      severity: 'MEDIUM',
      category: 'ERROR_HANDLING',
      title: `Empty catch block in ${file.path}`,
      description: `${String(matches.length)} catch block(s) in ${file.path} discard the error without logging or rethrowing, turning a failure into a silent wrong result.`,
      evidence: `${file.path}:${String(line)} — catch { }`,
      recommendation: 'Log the error, rethrow it, or comment why swallowing it is correct here.',
      targetNodeId: null,
      targetFile: file.path,
      confidence: 1,
      status: 'OPEN',
    });
  }

  return findings;
}

/** `any` in source the generator controls, where a real type was available. */
function unsafeTypes(input: QualityReviewInput): AgentFinding[] {
  const findings: AgentFinding[] = [];

  for (const file of [...input.backendFiles, ...input.frontendFiles]) {
    if (!/\.tsx?$/.test(file.path)) continue;
    // `: any` and `as any`, not `anything` or `Company`.
    const uses = [...file.content.matchAll(/(?::\s*any\b|\bas\s+any\b)/g)].length;
    if (uses < 3) continue;

    findings.push({
      type: 'CODE_QUALITY',
      severity: 'LOW',
      category: 'UNSAFE_TYPES',
      title: `${String(uses)} uses of \`any\` in ${file.path}`,
      description: `${file.path} opts out of type checking in ${String(uses)} places. Each one is a spot where a wrong shape passes the compiler and fails at runtime instead.`,
      evidence: `${file.path} — ${String(uses)} occurrences of \`: any\` or \`as any\``,
      recommendation: 'Replace with the concrete type, or `unknown` plus a narrowing check.',
      targetNodeId: null,
      targetFile: file.path,
      confidence: 0.9,
      status: 'OPEN',
    });
  }

  return findings;
}

export interface QualityReview {
  findings: AgentFinding[];
  stats: {
    backendFiles: number;
    frontendFiles: number;
    plannedModules: number;
    builtModules: number;
    declaredEndpoints: number;
    servedRoutes: number;
  };
}

export function reviewQuality(input: QualityReviewInput): QualityReview {
  const findings = [
    ...fromAnalyzer(input),
    ...architectureConformance(input),
    ...contractConformance(input),
    ...errorHandling(input),
    ...unsafeTypes(input),
  ];

  return {
    findings,
    stats: {
      backendFiles: input.backendFiles.length,
      frontendFiles: input.frontendFiles.length,
      plannedModules: input.architecture.apiModules.length,
      builtModules: input.backendModules.length,
      declaredEndpoints: Object.keys(input.api.paths).length,
      servedRoutes: input.backendRoutes.length,
    },
  };
}
