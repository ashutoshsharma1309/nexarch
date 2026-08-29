/**
 * Targeted validation: the checks a repair must survive, and no more.
 *
 * Step 13 forbids re-running the whole validation pipeline for a one-line
 * patch, so each check is scoped to its evidence source:
 *
 *   TYPECHECK       — the project's own `npm run typecheck`, really run,
 *                     in a persistent workspace so `npm install` happens
 *                     once per project rather than once per attempt.
 *   CONTRACT_AUDIT  — the frontend-vs-contract audit, pure and instant.
 *   MANIFEST_AUDIT  — the dependency review, pure and instant.
 *
 * The interface is injectable because the unit tests must exercise the
 * engine's *decisions* — retry, rollback, regression — without a real npm
 * install per test. The real implementation is what the live loop uses,
 * and its answers are exit codes.
 */
import { mkdirSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';

import { logger } from '../../../shared/logger/index.js';
import { LogBuffer } from '../../runner/lib/log-buffer.js';
import { runToCompletion } from '../../runner/lib/process-supervisor.js';
import { auditFrontendContract } from './contract-audit.js';
import { reviewDependencies } from './dependency-review.js';
import { latestArtifacts } from './artifact-store.js';
import { runnableFiles } from './runnable-project.js';
import { apiContractOf } from './repair-analysis.js';
import { scrub } from './runtime-validation.js';
import type { ArtifactType } from '../../../shared/contracts/index.js';
import type { RepairCheckKind, RepairCheckOutcome } from '../../../shared/types/repair.js';
import type { DependencyArea, PackageManifest } from './dependency-review.js';

export interface RepairValidator {
  /**
   * `scope` narrows a check to the files a plan authorized — the targeted
   * validation of Step 13. An unscoped run is the whole-project view the
   * baseline and the regression guard use. Only CONTRACT_AUDIT is
   * scopeable; the compiler and the manifest have no meaningful subset.
   */
  run(
    projectId: string,
    kind: RepairCheckKind,
    scope?: readonly string[],
  ): Promise<RepairCheckOutcome>;
}

/* ── Pure checks ───────────────────────────────────────────────────────── */

function artifactsMap(projectId: string): Partial<Record<ArtifactType, unknown>> {
  const map: Partial<Record<ArtifactType, unknown>> = {};
  for (const record of latestArtifacts(projectId)) map[record.type] = record.content;
  return map;
}

function contractAudit(projectId: string, scope?: readonly string[]): RepairCheckOutcome {
  const api = apiContractOf(projectId);
  const frontend = artifactsMap(projectId)['frontend-source'] as
    { files?: { path: string; content: string }[] } | undefined;
  if (!api || !frontend?.files) {
    return {
      kind: 'CONTRACT_AUDIT',
      status: 'FAIL',
      evidence: 'no contract or frontend source to audit',
    };
  }
  const inner = scope?.map((path) => path.replace(/^frontend\//, ''));
  const files = inner ? frontend.files.filter((file) => inner.includes(file.path)) : frontend.files;
  const audit = auditFrontendContract(files, api);
  return {
    kind: 'CONTRACT_AUDIT',
    status: audit.undeclared.length === 0 ? 'PASS' : 'FAIL',
    evidence:
      audit.undeclared.length === 0
        ? `${String(audit.calls.length)} calls, all declared`
        : `undeclared: ${audit.undeclared
            .slice(0, 3)
            .map((call) => `${call.method} ${call.raw} (${call.file})`)
            .join(' · ')}`,
  };
}

function manifestAudit(projectId: string): RepairCheckOutcome {
  const artifacts = artifactsMap(projectId);
  const areas: DependencyArea[] = [];
  for (const area of ['backend', 'frontend'] as const) {
    const config = artifacts[`${area}-config`] as
      { files?: { path: string; content: string }[] } | undefined;
    const source = artifacts[`${area}-source`] as
      { files?: { path: string; content: string }[] } | undefined;
    const manifestFile = config?.files?.find((file) => file.path === 'package.json');
    if (!manifestFile) continue;
    try {
      areas.push({
        area,
        manifest: JSON.parse(manifestFile.content) as PackageManifest,
        files: [...(config?.files ?? []), ...(source?.files ?? [])],
        hasLockfile: false,
      });
    } catch {
      return {
        kind: 'MANIFEST_AUDIT',
        status: 'FAIL',
        evidence: `${area}/package.json no longer parses`,
      };
    }
  }

  const review = reviewDependencies(areas);
  const problems = review.findings.filter((finding) =>
    ['UNUSED_DEPENDENCY', 'MISSING_DEPENDENCY', 'DUPLICATE_DEPENDENCY'].includes(finding.category),
  );
  return {
    kind: 'MANIFEST_AUDIT',
    status: problems.length === 0 ? 'PASS' : 'FAIL',
    evidence:
      problems.length === 0
        ? 'manifests and imports agree'
        : problems
            .slice(0, 3)
            .map((finding) => finding.title)
            .join(' · '),
  };
}

/* ── The real typecheck, in a persistent workspace ─────────────────────── */

const installed = new Set<string>();

function workspaceDirFor(projectId: string): string {
  return join(tmpdir(), 'nexarch-repair', projectId);
}

async function typecheck(projectId: string): Promise<RepairCheckOutcome> {
  const dir = workspaceDirFor(projectId);
  const files = runnableFiles(artifactsMap(projectId));
  if (files.length === 0) {
    return { kind: 'TYPECHECK', status: 'FAIL', evidence: 'no project files in the artifacts' };
  }

  // Rewrite the current file set every run — cheap — but install once.
  mkdirSync(dir, { recursive: true });
  const root = resolve(dir);
  for (const file of files) {
    // Containment (Step 13): even though these paths come from generators,
    // a validation workspace must never write outside its own directory.
    const target = resolve(dir, file.path);
    if (target !== root && !target.startsWith(root + sep)) {
      return {
        kind: 'TYPECHECK',
        status: 'FAIL',
        evidence: `refused to write outside the workspace: ${file.path}`,
      };
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.content);
  }

  const areas = ['backend', 'frontend'].filter((area) =>
    files.some((file) => file.path === `${area}/package.json`),
  );

  for (const area of areas) {
    const key = `${projectId}:${area}`;
    // An existing node_modules is trusted across processes: the repair
    // loop never changes dependencies without the manifest audit knowing,
    // and reinstalling identical packages per process would only be slower.
    if (existsSync(join(dir, area, 'node_modules'))) {
      installed.add(key);
      continue;
    }
    if (installed.has(key)) continue;
    const logs = new LogBuffer();
    const code = await runToCompletion(
      'npm',
      ['install', '--no-audit', '--no-fund'],
      join(dir, area),
      area === 'backend' ? 'backend' : 'frontend',
      logs,
    );
    if (code !== 0) {
      return {
        kind: 'TYPECHECK',
        status: 'FAIL',
        evidence: scrub(
          `npm install (${area}) exited ${String(code)}: ${logs.tail(3).join(' | ')}`,
        ),
      };
    }
    installed.add(key);
  }

  for (const area of areas) {
    const logs = new LogBuffer();
    const code = await runToCompletion(
      'npm',
      ['run', 'typecheck'],
      join(dir, area),
      area === 'backend' ? 'backend' : 'frontend',
      logs,
    );
    if (code !== 0) {
      return {
        kind: 'TYPECHECK',
        status: 'FAIL',
        evidence: scrub(
          `npm run typecheck (${area}) exited ${String(code)}: ${logs.tail(4).join(' | ')}`,
        ).slice(0, 600),
      };
    }
  }

  return { kind: 'TYPECHECK', status: 'PASS', evidence: `typecheck clean in ${areas.join(', ')}` };
}

export const realValidator: RepairValidator = {
  async run(projectId, kind, scope) {
    switch (kind) {
      case 'TYPECHECK':
        return typecheck(projectId);
      case 'CONTRACT_AUDIT':
        return Promise.resolve(contractAudit(projectId, scope));
      case 'MANIFEST_AUDIT':
        return Promise.resolve(manifestAudit(projectId));
    }
  },
};

/** Removes a project's repair workspace. Used by tests and cleanup. */
export function discardRepairWorkspace(projectId: string): void {
  try {
    rmSync(workspaceDirFor(projectId), { recursive: true, force: true });
    installed.delete(`${projectId}:backend`);
    installed.delete(`${projectId}:frontend`);
  } catch (error) {
    logger.debug('repair workspace cleanup failed', { projectId, error });
  }
}
