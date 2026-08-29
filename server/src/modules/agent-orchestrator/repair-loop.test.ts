/**
 * Repair loop tests (`npm test`).
 *
 * The live halves — a real npm install, a real tsc — run in the end-to-end
 * repair script. What belongs here is every *decision* the loop makes:
 * who may be repaired, in what order, what an edit is allowed to touch,
 * when a patch is rolled back, when the loop stops, and what no model may
 * override. The validator and the strategy are injectable precisely so
 * these decisions can be tested against scripted evidence.
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { classifyFinding, orderForRepair } from './lib/repair-eligibility.js';
import { analyzeRootCause, planRepair } from './lib/repair-analysis.js';
import { produceEdits } from './lib/repair-strategies.js';
import {
  applyEdits,
  locateFile,
  rollbackChangeset,
  snapshotFiles,
  UnauthorizedEditError,
} from './lib/repair-files.js';
import { diffLines } from './lib/line-diff.js';
import { runRepairSession } from './lib/repair-engine.js';
import { listRepairs, resetRepairStoreForTests, saveRepair } from './lib/repair-store.js';
import {
  getFinding,
  beginReview,
  recordFinding,
  resetFindingStoreForTests,
  setFindingStatus,
} from './lib/finding-store.js';
import { resetArtifactStoreForTests, writeArtifact, latestArtifact } from './lib/artifact-store.js';
import { auditFrontendContract, nearestDeclaredPath } from './lib/contract-audit.js';
import type { FindingRecord } from './lib/finding-store.js';
import type { AgentFinding } from '../../shared/contracts/index.js';
import type { RepairCheckKind, RepairCheckOutcome } from '../../shared/types/repair.js';

const PROJECT = 'proj-repair';

/* ── A small but real artifact fixture ────────────────────────────────── */

const SERVICE_FILE = `import { apiClient } from '@/shared/services/api-client';

const BASE_PATH = '/order-items';

export async function listOrders() {
  const response = await apiClient.get(BASE_PATH);
  return response.data;
}

export async function getOrder(id: string) {
  const response = await apiClient.get(\`\${BASE_PATH}/\${id}\`);
  return response.data;
}
`;

const BROKEN_BACKEND_FILE = `import { missing } from './does-not-exist.js';
export function priceOf(value: number): number {
  return value * 2;
}
`;

const API_CONTRACT = {
  openapi: '3.0.0',
  info: { title: 'x', version: '1' },
  paths: {
    '/orders': { get: {}, post: {} },
    '/orders/{id}': { get: {} },
    '/products': { get: {} },
  },
};

function seedArtifacts(): void {
  const write = (type: string, content: unknown): void => {
    writeArtifact({
      projectId: PROJECT,
      runId: 'run-1',
      type: type as never,
      agentId: 'backend-engineer',
      agentVersion: '1',
      derivedFrom: [],
      content,
    });
  };
  write('api-contract', API_CONTRACT);
  write('frontend-source', {
    files: [{ path: 'src/features/orders/services/orders.service.ts', content: SERVICE_FILE }],
  });
  write('backend-source', {
    files: [{ path: 'src/modules/pricing/pricing.service.ts', content: BROKEN_BACKEND_FILE }],
  });
  write('backend-config', {
    files: [
      {
        path: 'package.json',
        content: JSON.stringify(
          { dependencies: { express: '^5.0.0', 'left-pad': '^1.3.0' }, devDependencies: {} },
          null,
          2,
        ),
      },
    ],
  });
  write('frontend-config', { files: [{ path: 'package.json', content: '{"dependencies":{}}' }] });
}

function seedFinding(overrides: Partial<AgentFinding> & { category: string }): FindingRecord {
  const version = beginReview(PROJECT);
  const { record } = recordFinding({
    projectId: PROJECT,
    runId: 'run-1',
    agentId: 'security-engineer',
    reviewVersion: version,
    finding: {
      type: 'RUNTIME',
      severity: 'HIGH',
      title: 't',
      description: 'd',
      targetNodeId: null,
      targetFile: null,
      evidence: null,
      recommendation: null,
      confidence: 1,
      status: 'OPEN',
      ...overrides,
    },
  });
  return record;
}

function fakeValidator(script: Record<RepairCheckKind, 'PASS' | 'FAIL'>): {
  run: (projectId: string, kind: RepairCheckKind) => Promise<RepairCheckOutcome>;
  calls: RepairCheckKind[];
} {
  const calls: RepairCheckKind[] = [];
  return {
    calls,
    run: (_projectId, kind) => {
      calls.push(kind);
      return Promise.resolve({
        kind,
        status: script[kind],
        evidence: `${kind} scripted ${script[kind]}`,
      });
    },
  };
}

beforeEach(() => {
  resetFindingStoreForTests();
  resetArtifactStoreForTests();
  resetRepairStoreForTests();
});

/* ── Eligibility (Step 2) ─────────────────────────────────────────────── */

describe('repair eligibility', () => {
  const finding = (
    type: AgentFinding['type'],
    category: string,
    extra: Partial<FindingRecord> = {},
  ): FindingRecord =>
    ({
      id: 'f',
      projectId: PROJECT,
      runId: 'r',
      agentId: 'security-engineer',
      type: type ?? 'GENERAL',
      severity: 'HIGH',
      category,
      title: 't',
      description: 'd',
      evidence: null,
      targetNodeId: null,
      targetFile: null,
      recommendation: null,
      confidence: 1,
      status: 'OPEN',
      firstSeenReview: 1,
      lastSeenReview: 1,
      createdAt: '',
      updatedAt: '',
      ...extra,
    }) satisfies FindingRecord;

  it('repairs the mechanical, reviews the human, skips the informational', () => {
    assert.equal(
      classifyFinding(finding('RUNTIME', 'TYPECHECK_FAILURE')).eligibility,
      'AUTO_REPAIRABLE',
    );
    assert.equal(
      classifyFinding(finding('DEPENDENCY', 'UNUSED_DEPENDENCY')).eligibility,
      'AUTO_REPAIRABLE',
    );
    assert.equal(
      classifyFinding(finding('SECURITY', 'AUTHENTICATION')).eligibility,
      'REQUIRES_REVIEW',
    );
    assert.equal(
      classifyFinding(finding('DEPENDENCY', 'MISSING_DEPENDENCY')).eligibility,
      'REQUIRES_REVIEW',
      'installing a package is a person’s call (Step 27)',
    );
    assert.equal(
      classifyFinding(finding('DEPENDENCY', 'VULNERABILITY_SCAN', { severity: 'INFO' }))
        .eligibility,
      'NOT_REPAIRABLE',
    );
  });

  it('never lets "unclassified" mean "go ahead"', () => {
    const decision = classifyFinding(finding('GENERAL', 'SOMETHING_NEW'));
    assert.equal(decision.eligibility, 'REQUIRES_REVIEW');
    assert.match(decision.reason, /No rule covers/);
  });

  it('hard-stops destructive database language (Step 28)', () => {
    const decision = classifyFinding(
      finding('RUNTIME', 'TYPECHECK_FAILURE', {
        description: 'The migration runs DROP TABLE orders before recreating it.',
      }),
    );
    assert.equal(decision.eligibility, 'REQUIRES_REVIEW');
    assert.match(decision.reason, /destructive/);
  });

  it('orders a broken build before cosmetics (Step 3)', () => {
    const ordered = orderForRepair([
      finding('CODE_QUALITY', 'DUPLICATION', { id: 'a', severity: 'MEDIUM' }),
      finding('RUNTIME', 'BUILD_FAILURE', { id: 'b', severity: 'HIGH' }),
      finding('INTEGRATION', 'API_CONTRACT', { id: 'c', severity: 'HIGH' }),
      finding('SECURITY', 'SECRETS', { id: 'd', severity: 'CRITICAL' }),
    ]);
    assert.deepEqual(
      ordered.map((entry) => entry.id),
      ['d', 'b', 'c', 'a'],
    );
  });
});

/* ── Root cause and plan (Steps 4–6) ──────────────────────────────────── */

describe('root cause and plan', () => {
  it('reads the compiler’s own error line', () => {
    seedArtifacts();
    const finding = seedFinding({
      category: 'TYPECHECK_FAILURE',
      evidence:
        "npm run typecheck (backend) → exit 2\nsrc/modules/pricing/pricing.service.ts(1,25): error TS2307: Cannot find module './does-not-exist.js'",
    });
    const rca = analyzeRootCause(finding);
    assert.equal(rca.repairability, 'AUTO_REPAIRABLE');
    assert.ok(rca.confidence >= 0.9);
    assert.deepEqual(rca.affectedFiles, ['backend/src/modules/pricing/pricing.service.ts']);
    const plan = planRepair(finding, rca);
    assert.equal(plan?.strategy, 'fix-compile-error');
    assert.deepEqual(plan.validation, ['TYPECHECK']);
  });

  it('re-derives a contract mismatch from the current artifacts', () => {
    seedArtifacts();
    const finding = seedFinding({ type: 'INTEGRATION', category: 'API_CONTRACT' });
    const rca = analyzeRootCause(finding);
    assert.equal(rca.repairability, 'AUTO_REPAIRABLE');
    assert.match(rca.rootCause, /order-items/);
    assert.deepEqual(rca.affectedFiles, [
      'frontend/src/features/orders/services/orders.service.ts',
    ]);
  });

  it('downgrades a backend-side mismatch to review instead of guessing', () => {
    seedArtifacts();
    // Make the frontend clean: the mismatch must then be backend-side.
    writeArtifact({
      projectId: PROJECT,
      runId: 'run-2',
      type: 'frontend-source',
      agentId: 'frontend-engineer',
      agentVersion: '1',
      derivedFrom: [],
      content: {
        files: [
          {
            path: 'src/features/orders/services/orders.service.ts',
            content: SERVICE_FILE.replaceAll('/order-items', '/orders'),
          },
        ],
      },
    });
    const finding = seedFinding({ type: 'INTEGRATION', category: 'API_CONTRACT' });
    const rca = analyzeRootCause(finding);
    assert.equal(rca.repairability, 'REQUIRES_REVIEW');
    assert.equal(planRepair(finding, rca), null);
  });
});

/* ── The edit gate (Steps 8, 10–12) ───────────────────────────────────── */

describe('the edit gate', () => {
  it('refuses an edit outside the authorized files, touching nothing', () => {
    seedArtifacts();
    const before = locateFile(PROJECT, 'backend/package.json')?.content;
    assert.throws(
      () =>
        applyEdits(
          PROJECT,
          'r',
          'rep',
          'f',
          'reason',
          [{ file: 'backend/package.json', find: 'left-pad', replace: 'right-pad' }],
          ['frontend/src/other.ts'],
        ),
      UnauthorizedEditError,
    );
    assert.equal(locateFile(PROJECT, 'backend/package.json')?.content, before);
  });

  it('refuses an ambiguous or stale fragment', () => {
    seedArtifacts();
    const path = 'frontend/src/features/orders/services/orders.service.ts';
    assert.throws(() =>
      applyEdits(
        PROJECT,
        'r',
        'rep',
        'f',
        'reason',
        [
          { file: path, find: 'BASE_PATH', replace: 'X' }, // occurs three times
        ],
        [path],
      ),
    );
    assert.throws(() =>
      applyEdits(
        PROJECT,
        'r',
        'rep',
        'f',
        'reason',
        [{ file: path, find: 'not in this file at all', replace: 'X' }],
        [path],
      ),
    );
  });

  it('applies, versions, diffs — and rolls back to the snapshot', () => {
    seedArtifacts();
    const path = 'frontend/src/features/orders/services/orders.service.ts';
    const snapshot = snapshotFiles(PROJECT, [path]);
    const versionBefore = latestArtifact(PROJECT, 'frontend-source')?.version ?? 0;

    const changeset = applyEdits(
      PROJECT,
      'r',
      'rep',
      'f',
      'align path',
      [
        {
          file: path,
          find: "const BASE_PATH = '/order-items';",
          replace: "const BASE_PATH = '/orders';",
        },
      ],
      [path],
    );

    assert.equal(changeset.files.length, 1);
    const [change] = changeset.files;
    assert.ok(change);
    assert.equal(change.addedLines, 1);
    assert.equal(change.removedLines, 1);
    assert.equal(change.newVersion, versionBefore + 1);
    assert.match(locateFile(PROJECT, path)?.content ?? '', /'\/orders'/);

    rollbackChangeset(PROJECT, 'r', changeset, snapshot);
    assert.equal(locateFile(PROJECT, path)?.content, SERVICE_FILE);
    assert.equal(changeset.rolledBack, true);
    // Rollback is a new version, not rewritten history.
    assert.equal(latestArtifact(PROJECT, 'frontend-source')?.version, versionBefore + 2);
  });
});

/* ── Deterministic strategies (Steps 7–8) ─────────────────────────────── */

describe('deterministic strategies', () => {
  it('aligns a wrong frontend path to the contract’s nearest declared one', async () => {
    seedArtifacts();
    const finding = seedFinding({ type: 'INTEGRATION', category: 'API_CONTRACT' });
    const rca = analyzeRootCause(finding);
    const plan = planRepair(finding, rca);
    assert.ok(plan);
    const result = await produceEdits(finding, rca, plan, '');
    assert.equal(result.error, null);
    assert.ok(result.edits.length > 0);
    // Minimal: only the BASE_PATH line changes; audit comes back clean.
    applyEdits(PROJECT, 'r', 'rep', finding.id, 'x', result.edits, plan.authorizedFiles);
    const frontend = latestArtifact(PROJECT, 'frontend-source')?.content as {
      files: { path: string; content: string }[];
    };
    const audit = auditFrontendContract(frontend.files, API_CONTRACT as never);
    assert.deepEqual(audit.undeclared, []);
  });

  it('removes an unused dependency without corrupting the manifest', async () => {
    seedArtifacts();
    const finding = seedFinding({
      type: 'DEPENDENCY',
      category: 'UNUSED_DEPENDENCY',
      title: 'Unused dependency "left-pad"',
      targetFile: 'backend/package.json',
    });
    const rca = analyzeRootCause(finding);
    const plan = planRepair(finding, rca);
    assert.ok(plan);
    const result = await produceEdits(finding, rca, plan, '');
    applyEdits(PROJECT, 'r', 'rep', finding.id, 'x', result.edits, plan.authorizedFiles);
    const manifest = locateFile(PROJECT, 'backend/package.json')?.content ?? '';
    const parsed = JSON.parse(manifest) as { dependencies: Record<string, string> };
    assert.ok(!('left-pad' in parsed.dependencies));
    assert.ok('express' in parsed.dependencies);
  });

  it('removes a broken import only when its bindings are unused', async () => {
    seedArtifacts();
    const finding = seedFinding({
      category: 'TYPECHECK_FAILURE',
      evidence:
        "src/modules/pricing/pricing.service.ts(1,25): error TS2307: Cannot find module './does-not-exist.js'",
    });
    const rca = analyzeRootCause(finding);
    const plan = planRepair(finding, rca);
    assert.ok(plan);
    const result = await produceEdits(finding, rca, plan, '');
    assert.equal(result.strategy, 'remove-broken-import');
    applyEdits(PROJECT, 'r', 'rep', finding.id, 'x', result.edits, plan.authorizedFiles);
    const content =
      locateFile(PROJECT, 'backend/src/modules/pricing/pricing.service.ts')?.content ?? '';
    assert.ok(!content.includes('does-not-exist'));
    assert.ok(content.includes('priceOf'));
  });

  it('refuses an ambiguous path rewrite rather than guessing', () => {
    // Two declared paths, equally distant — no repair.
    assert.equal(nearestDeclaredPath(API_CONTRACT as never, 'GET', '/zzzz'), null);
  });
});

/* ── The engine (Steps 14–19, 36–38) ──────────────────────────────────── */

describe('the repair engine', () => {
  const contractFinding = (): FindingRecord =>
    seedFinding({ type: 'INTEGRATION', category: 'API_CONTRACT', severity: 'HIGH' });

  it('fixes, records, and marks — only with a passing validation', async () => {
    seedArtifacts();
    const finding = contractFinding();
    const validator = fakeValidator({
      TYPECHECK: 'PASS',
      CONTRACT_AUDIT: 'PASS',
      MANIFEST_AUDIT: 'PASS',
    });
    const session = await runRepairSession(
      PROJECT,
      {},
      {
        validator,
        produce: (f, rca, plan) => produceEdits(f, rca, plan, ''),
      },
    );

    assert.equal(session.counts.fixed, 1);
    assert.equal(getFinding(PROJECT, finding.id)?.status, 'FIXED');
    const record = listRepairs(PROJECT).find((entry) => entry.findingId === finding.id);
    assert.equal(record?.result, 'FIXED');
    assert.ok(record.changeset);
    assert.equal(record.attempts[0]?.outcome, 'ACCEPTED');
  });

  it('rejects after the configured attempts, rolled back each time', async () => {
    seedArtifacts();
    const finding = contractFinding();
    const validator = fakeValidator({
      TYPECHECK: 'PASS',
      CONTRACT_AUDIT: 'FAIL',
      MANIFEST_AUDIT: 'PASS',
    });
    const session = await runRepairSession(
      PROJECT,
      { maxAttemptsPerFinding: 2 },
      {
        validator,
        produce: (f, rca, plan) => produceEdits(f, rca, plan, ''),
      },
    );

    assert.equal(session.counts.fixed, 0);
    assert.equal(session.counts.rejected, 1);
    assert.equal(getFinding(PROJECT, finding.id)?.status, 'REJECTED');
    const record = listRepairs(PROJECT).find((entry) => entry.findingId === finding.id);
    assert.equal(record?.attempts.length, 2);
    assert.equal(record.rolledBack, true);
    // The project is back to its pre-repair state — no half-applied surgery.
    assert.equal(
      locateFile(PROJECT, 'frontend/src/features/orders/services/orders.service.ts')?.content,
      SERVICE_FILE,
    );
  });

  it('escalates the second attempt to the full check set (Step 14)', async () => {
    seedArtifacts();
    contractFinding();
    const validator = fakeValidator({
      TYPECHECK: 'PASS',
      CONTRACT_AUDIT: 'FAIL',
      MANIFEST_AUDIT: 'PASS',
    });
    await runRepairSession(
      PROJECT,
      { maxAttemptsPerFinding: 2 },
      {
        validator,
        produce: (f, rca, plan) => produceEdits(f, rca, plan, ''),
      },
    );
    // Baseline (3) + attempt 1 targeted (1) + attempt 2 full set (3).
    const afterBaseline = validator.calls.slice(3);
    assert.deepEqual(afterBaseline.slice(0, 1), ['CONTRACT_AUDIT']);
    assert.equal(afterBaseline.length, 4);
  });

  it('rolls back a repair that breaks previously working checks (Steps 17, 34)', async () => {
    seedArtifacts();
    const finding = contractFinding();
    // Targeted check passes; the baseline-passing TYPECHECK breaks after the patch.
    let patched = false;
    const validator = {
      calls: [] as RepairCheckKind[],
      run: (_p: string, kind: RepairCheckKind) => {
        validator.calls.push(kind);
        const status: 'PASS' | 'FAIL' = kind === 'TYPECHECK' && patched ? 'FAIL' : 'PASS';
        return Promise.resolve({ kind, status, evidence: `${kind} ${status}` });
      },
    };
    const session = await runRepairSession(
      PROJECT,
      {},
      {
        validator,
        produce: async (f, rca, plan) => {
          patched = true;
          return produceEdits(f, rca, plan, '');
        },
      },
    );

    assert.equal(session.counts.rolledBack, 1);
    assert.equal(getFinding(PROJECT, finding.id)?.status, 'REGRESSION');
    assert.equal(
      locateFile(PROJECT, 'frontend/src/features/orders/services/orders.service.ts')?.content,
      SERVICE_FILE,
      'the regression was not rolled back',
    );
    const record = listRepairs(PROJECT).find((entry) => entry.findingId === finding.id);
    assert.equal(record?.attempts[0]?.outcome, 'REGRESSION');
    assert.ok(record.attempts[0].regressions.length > 0);
  });

  it('stops a finding that was fixed before and came back (Step 16)', async () => {
    seedArtifacts();
    const finding = contractFinding();
    saveRepair({
      id: 'old',
      projectId: PROJECT,
      findingId: finding.id,
      findingTitle: 't',
      severity: 'HIGH',
      agentId: 'repair-engineer',
      eligibility: { eligibility: 'AUTO_REPAIRABLE', reason: 'x' },
      rootCause: null,
      plan: null,
      attempts: [],
      changeset: null,
      result: 'FIXED',
      rolledBack: false,
      tokens: { input: 0, output: 0, context: 0 },
      durationMs: 1,
      createdAt: '',
    });
    const validator = fakeValidator({
      TYPECHECK: 'PASS',
      CONTRACT_AUDIT: 'PASS',
      MANIFEST_AUDIT: 'PASS',
    });
    const session = await runRepairSession(
      PROJECT,
      {},
      {
        validator,
        produce: (f, rca, plan) => produceEdits(f, rca, plan, ''),
      },
    );
    assert.equal(session.counts.repairLoops, 1);
    assert.equal(session.counts.fixed, 0);
    assert.equal(getFinding(PROJECT, finding.id)?.status, 'REPAIR_LOOP');
  });

  it('spends the budget on severity, not on arrival order (Steps 3, 35–36)', async () => {
    seedArtifacts();
    const low = seedFinding({
      type: 'DEPENDENCY',
      category: 'UNUSED_DEPENDENCY',
      severity: 'LOW',
      title: 'Unused dependency "left-pad"',
      targetFile: 'backend/package.json',
    });
    const high = contractFinding();
    const validator = fakeValidator({
      TYPECHECK: 'PASS',
      CONTRACT_AUDIT: 'PASS',
      MANIFEST_AUDIT: 'PASS',
    });
    const session = await runRepairSession(
      PROJECT,
      { maxRepairsPerRun: 1 },
      {
        validator,
        produce: (f, rca, plan) => produceEdits(f, rca, plan, ''),
      },
    );
    assert.equal(session.finalState, 'REPAIR_BUDGET_EXCEEDED');
    assert.equal(getFinding(PROJECT, high.id)?.status, 'FIXED');
    assert.equal(
      getFinding(PROJECT, low.id)?.status,
      'OPEN',
      'the LOW finding must not consume the budget',
    );
  });

  it('routes the unrepairable to a person and touches nothing (Step 25)', async () => {
    seedArtifacts();
    const finding = seedFinding({ type: 'SECURITY', category: 'AUTHENTICATION', severity: 'HIGH' });
    const validator = fakeValidator({
      TYPECHECK: 'PASS',
      CONTRACT_AUDIT: 'PASS',
      MANIFEST_AUDIT: 'PASS',
    });
    const session = await runRepairSession(
      PROJECT,
      {},
      {
        validator,
        produce: (f, rca, plan) => produceEdits(f, rca, plan, ''),
      },
    );
    assert.equal(session.counts.requiresReview, 1);
    assert.equal(session.finalState, 'REQUIRES_REVIEW');
    assert.equal(getFinding(PROJECT, finding.id)?.status, 'REQUIRES_REVIEW');
    const record = listRepairs(PROJECT).find((entry) => entry.findingId === finding.id);
    assert.equal(record?.changeset, null);
  });

  it('never overrides a person’s judgement', async () => {
    seedArtifacts();
    const finding = contractFinding();
    setFindingStatus(PROJECT, finding.id, 'FALSE_POSITIVE');
    const validator = fakeValidator({
      TYPECHECK: 'PASS',
      CONTRACT_AUDIT: 'PASS',
      MANIFEST_AUDIT: 'PASS',
    });
    const session = await runRepairSession(
      PROJECT,
      {},
      {
        validator,
        produce: (f, rca, plan) => produceEdits(f, rca, plan, ''),
      },
    );
    assert.equal(session.counts.considered, 0);
    assert.equal(getFinding(PROJECT, finding.id)?.status, 'FALSE_POSITIVE');
  });

  it('reaches PASSED only when nothing is open and nothing awaits review', async () => {
    seedArtifacts();
    contractFinding();
    const validator = fakeValidator({
      TYPECHECK: 'PASS',
      CONTRACT_AUDIT: 'PASS',
      MANIFEST_AUDIT: 'PASS',
    });
    const session = await runRepairSession(
      PROJECT,
      {},
      {
        validator,
        produce: (f, rca, plan) => produceEdits(f, rca, plan, ''),
      },
    );
    assert.equal(session.finalState, 'PASSED');
    assert.ok(session.stopReason.length > 0);
  });
});

/* ── Diff ─────────────────────────────────────────────────────────────── */

describe('line diff', () => {
  it('counts and locates a one-line change', () => {
    const diff = diffLines('a\nb\nc', 'a\nB\nc');
    assert.equal(diff.added, 1);
    assert.equal(diff.removed, 1);
    assert.equal(diff.hunks.length, 1);
    assert.equal(diff.hunks[0]?.line, 2);
    assert.deepEqual(diff.hunks[0].removed, ['b']);
    assert.deepEqual(diff.hunks[0].added, ['B']);
  });

  it('reports no hunks for identical content', () => {
    assert.deepEqual(diffLines('x\ny', 'x\ny').hunks, []);
  });
});
