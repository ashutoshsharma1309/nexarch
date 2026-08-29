/**
 * What actually broke, and what a repair may do about it.
 *
 * Root cause comes from evidence first: a typecheck finding carries the
 * compiler's own `file(line,col): error TSxxxx` line, a contract finding
 * is re-derived by running the audit *now* against the latest artifacts
 * rather than parsing stale finding text. The model is not consulted here
 * at all — every cause this file can name, it names from artifacts.
 *
 * The RCA may *downgrade* eligibility, never upgrade it. Classification
 * said "contract mismatches are repairable"; the RCA is where we learn
 * whether this particular mismatch is the frontend calling a wrong path
 * (patchable) or the backend missing an endpoint (generation-scale work),
 * and the second becomes REQUIRES_REVIEW no matter what the rule said.
 */
import { auditFrontendContract, nearestDeclaredPath } from './contract-audit.js';
import { latestArtifact } from './artifact-store.js';
import type { FindingRecord } from './finding-store.js';
import type { OpenApiDocument } from '../../../shared/types/design.js';
import type {
  RepairCheckKind,
  RepairPlan,
  RootCauseAnalysis,
} from '../../../shared/types/repair.js';

interface FileCarrier {
  files?: { path: string; content: string }[];
}

function frontendFiles(projectId: string): { path: string; content: string }[] {
  const record = latestArtifact(projectId, 'frontend-source');
  return ((record?.content as FileCarrier | undefined)?.files ?? []).map((file) => ({
    path: file.path,
    content: file.content,
  }));
}

export function apiContractOf(projectId: string): OpenApiDocument | null {
  return (
    (latestArtifact(projectId, 'api-contract')?.content as OpenApiDocument | undefined) ?? null
  );
}

/** `src/x/y.ts(12,25): error TS2307: Cannot find module './z.js'` */
const TSC_ERROR = /([\w./-]+\.tsx?)\((\d+),\d+\):\s*error (TS\d+):\s*(.+)/;

function analyzeTypecheck(finding: FindingRecord): RootCauseAnalysis {
  const evidence = finding.evidence ?? '';
  const match = TSC_ERROR.exec(evidence);
  const area = evidence.includes('(frontend)') ? 'frontend' : 'backend';

  if (!match) {
    return {
      findingId: finding.id,
      rootCause: 'The compiler failed but its error line could not be parsed from the evidence.',
      affectedNodes: [],
      affectedArtifacts: [`${area}-source`],
      affectedFiles: [],
      confidence: 0.3,
      repairability: 'REQUIRES_REVIEW',
      method: 'deterministic',
    };
  }

  const [, file, line, code, message] = match;
  return {
    findingId: finding.id,
    rootCause: `${code} in ${file ?? ''} line ${line ?? ''}: ${message?.trim() ?? ''}`,
    affectedNodes: [],
    affectedArtifacts: [`${area}-source`],
    affectedFiles: [`${area}/${file ?? ''}`],
    confidence: 0.95,
    repairability: 'AUTO_REPAIRABLE',
    method: 'deterministic',
  };
}

function analyzeContract(finding: FindingRecord): RootCauseAnalysis {
  const api = apiContractOf(finding.projectId);
  const files = frontendFiles(finding.projectId);

  if (!api || files.length === 0) {
    return {
      findingId: finding.id,
      rootCause: 'No API contract or frontend source is available to compare.',
      affectedNodes: [],
      affectedArtifacts: [],
      affectedFiles: [],
      confidence: 0.2,
      repairability: 'REQUIRES_REVIEW',
      method: 'deterministic',
    };
  }

  // Re-derived now, not parsed from the finding: the audit is cheap and
  // the artifacts may have moved since the finding was recorded.
  const audit = auditFrontendContract(files, api);

  if (audit.undeclared.length === 0) {
    return {
      findingId: finding.id,
      rootCause:
        'The current frontend calls only declared operations — the mismatch is on the backend side (a declared endpoint is missing or unimplemented), which is generation-scale work, not a patch.',
      affectedNodes: [],
      affectedArtifacts: ['backend-source'],
      affectedFiles: [],
      confidence: 0.85,
      repairability: 'REQUIRES_REVIEW',
      method: 'deterministic',
    };
  }

  const resolvable = audit.undeclared.filter((call) =>
    nearestDeclaredPath(api, call.method, call.resolved),
  );
  /*
   * Only files whose mismatches are actually resolvable are authorized.
   * A live run taught this the hard way: the generated frontend carried
   * *unresolvable* mismatches too (DELETE calls the contract never
   * declares), and authorizing every mismatched file set a validation bar
   * — a globally clean audit — that no path alignment could reach. The
   * repair fixes what alignment can fix; the remainder is named in the
   * cause and stays visible, on the backend side where it belongs.
   */
  const affectedFiles = [...new Set(resolvable.map((call) => `frontend/${call.file}`))];
  const unresolvable = audit.undeclared.length - resolvable.length;

  return {
    findingId: finding.id,
    rootCause: `${String(audit.undeclared.length)} frontend call(s) use paths the contract does not declare: ${audit.undeclared
      .slice(0, 3)
      .map((call) => `${call.method} ${call.raw}`)
      .join(', ')}. ${String(resolvable.length)} have exactly one nearest declared path${
      unresolvable > 0
        ? `; ${String(unresolvable)} have no declared counterpart and need the contract regenerated`
        : ''
    }.`,
    affectedNodes: [],
    affectedArtifacts: ['frontend-source'],
    affectedFiles,
    confidence: unresolvable === 0 ? 0.9 : 0.7,
    repairability: resolvable.length > 0 ? 'AUTO_REPAIRABLE' : 'REQUIRES_REVIEW',
    method: 'deterministic',
  };
}

function analyzeUnusedDependency(finding: FindingRecord): RootCauseAnalysis {
  const name = /"([^"]+)"/.exec(finding.title)?.[1];
  const manifest = finding.targetFile; // `backend/package.json`
  if (!name || !manifest) {
    return {
      findingId: finding.id,
      rootCause: 'The package name could not be read from the finding.',
      affectedNodes: [],
      affectedArtifacts: [],
      affectedFiles: [],
      confidence: 0.2,
      repairability: 'REQUIRES_REVIEW',
      method: 'deterministic',
    };
  }
  return {
    findingId: finding.id,
    rootCause: `${name} is declared in ${manifest} and nothing imports it or invokes it from a script.`,
    affectedNodes: [],
    affectedArtifacts: [manifest.startsWith('backend') ? 'backend-config' : 'frontend-config'],
    affectedFiles: [manifest],
    confidence: 0.85,
    repairability: 'AUTO_REPAIRABLE',
    method: 'deterministic',
  };
}

export function analyzeRootCause(finding: FindingRecord): RootCauseAnalysis {
  const key = `${finding.type}/${finding.category}`;
  if (key === 'RUNTIME/TYPECHECK_FAILURE' || key === 'RUNTIME/BUILD_FAILURE') {
    return analyzeTypecheck(finding);
  }
  if (
    key === 'INTEGRATION/API_CONTRACT' ||
    key === 'CODE_QUALITY/CONTRACT_MISMATCH' ||
    finding.category === 'API_CONTRACT'
  ) {
    return analyzeContract(finding);
  }
  if (key === 'DEPENDENCY/UNUSED_DEPENDENCY' || key === 'DEPENDENCY/DUPLICATE_DEPENDENCY') {
    return analyzeUnusedDependency(finding);
  }

  return {
    findingId: finding.id,
    rootCause: `No deterministic analysis covers ${key}.`,
    affectedNodes: [],
    affectedArtifacts: [],
    affectedFiles: finding.targetFile ? [finding.targetFile] : [],
    confidence: 0.3,
    repairability: 'REQUIRES_REVIEW',
    method: 'deterministic',
  };
}

/* ── Plan (Step 6) ─────────────────────────────────────────────────────── */

const STRATEGY_BY_KEY: Record<
  string,
  { strategy: string; checks: RepairCheckKind[]; risk: RepairPlan['risk'] }
> = {
  'RUNTIME/TYPECHECK_FAILURE': {
    strategy: 'fix-compile-error',
    checks: ['TYPECHECK'],
    risk: 'LOW',
  },
  'RUNTIME/BUILD_FAILURE': { strategy: 'fix-compile-error', checks: ['TYPECHECK'], risk: 'LOW' },
  'INTEGRATION/API_CONTRACT': {
    strategy: 'align-frontend-call',
    checks: ['CONTRACT_AUDIT'],
    risk: 'LOW',
  },
  'CODE_QUALITY/CONTRACT_MISMATCH': {
    strategy: 'align-frontend-call',
    checks: ['CONTRACT_AUDIT'],
    risk: 'LOW',
  },
  'GENERAL/API_CONTRACT': {
    strategy: 'align-frontend-call',
    checks: ['CONTRACT_AUDIT'],
    risk: 'LOW',
  },
  'DEPENDENCY/UNUSED_DEPENDENCY': {
    strategy: 'remove-unused-dependency',
    checks: ['MANIFEST_AUDIT'],
    risk: 'LOW',
  },
  'DEPENDENCY/DUPLICATE_DEPENDENCY': {
    strategy: 'remove-unused-dependency',
    checks: ['MANIFEST_AUDIT'],
    risk: 'LOW',
  },
};

export function planRepair(finding: FindingRecord, rca: RootCauseAnalysis): RepairPlan | null {
  if (rca.repairability !== 'AUTO_REPAIRABLE' || rca.affectedFiles.length === 0) return null;
  const mapping = STRATEGY_BY_KEY[`${finding.type}/${finding.category}`];
  if (!mapping) return null;

  return {
    findingId: finding.id,
    strategy: mapping.strategy,
    intent: `Resolve: ${finding.title}. Cause: ${rca.rootCause}`,
    authorizedFiles: rca.affectedFiles,
    targetNodes: rca.affectedNodes,
    validation: mapping.checks,
    risk: mapping.risk,
    rollback: 'Restore the snapshotted content of every authorized file as a new artifact version.',
  };
}
