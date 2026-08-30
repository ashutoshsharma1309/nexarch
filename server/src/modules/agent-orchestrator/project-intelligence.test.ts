/**
 * Project intelligence tests (`npm test`).
 *
 * The dashboard's one hard promise is that nothing on it is invented:
 * health states follow from rules over real records, statuses follow from
 * health, and a subsystem that never ran says NOT_RUN. These tests pin the
 * rule table — every state with the input that must produce it — and the
 * run-history join that keeps historical rows honest about what they can
 * and cannot know.
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import {
  assembleIntelligence,
  computeHealth,
  computeStatus,
  runHistory,
} from './lib/project-intelligence.js';
import {
  beginReview,
  recordFinding,
  resetFindingStoreForTests,
  setFindingRepairState,
} from './lib/finding-store.js';
import { resetArtifactStoreForTests, writeArtifact } from './lib/artifact-store.js';
import { resetRepairStoreForTests } from './lib/repair-store.js';
import type { FindingRecord } from './lib/finding-store.js';
import type { AgentFinding } from '../../shared/contracts/index.js';
import type { RepairSessionState } from '../../shared/types/repair.js';
import type { ValidationSummary } from '../../shared/types/validation.js';

const PROJECT = 'intel-test';

function validation(overrides: Partial<ValidationSummary> = {}): ValidationSummary {
  return {
    projectId: PROJECT,
    runId: 'run-1',
    generatedAt: '2026-08-27T10:00:00.000Z',
    rows: [
      { name: 'Build', status: 'PASS', detail: 'backend exit 0' },
      { name: 'Type Check', status: 'PASS', detail: 'backend exit 0' },
      { name: 'Lint', status: 'PASS', detail: 'backend exit 0' },
      { name: 'Startup', status: 'PASS', detail: 'backend running' },
      { name: 'Health', status: 'PASS', detail: 'health answered' },
      { name: 'Integration', status: 'PASS', detail: '6/6 checks' },
      { name: 'Tests', status: 'PASS', detail: '9/9' },
    ],
    tests: { total: 9, passed: 9, failed: 0, blocked: 0, skipped: 0, failedCritical: 0 },
    gate: 'PASSED',
    gateReason: 'all passed',
    agents: [],
    ...overrides,
  };
}

function finding(overrides: Partial<AgentFinding> & { category: string }): FindingRecord {
  const version = beginReview(PROJECT);
  return recordFinding({
    projectId: PROJECT,
    runId: 'run-1',
    agentId: 'security-engineer',
    reviewVersion: version,
    finding: {
      type: 'SECURITY',
      severity: 'MEDIUM',
      title: `t-${overrides.category}-${overrides.severity ?? 'MEDIUM'}`,
      description: 'd',
      targetNodeId: null,
      targetFile: `x/${overrides.category}/${overrides.severity ?? 'M'}`,
      evidence: null,
      recommendation: null,
      confidence: 1,
      status: 'OPEN',
      ...overrides,
    },
  }).record;
}

function repairs(overrides: Partial<RepairSessionState['counts']> = {}): RepairSessionState {
  return {
    id: 's1',
    projectId: PROJECT,
    status: 'COMPLETED',
    finalState: 'PASSED',
    stopReason: 'done',
    counts: {
      considered: 1,
      autoRepairable: 1,
      fixed: 1,
      rejected: 0,
      requiresReview: 0,
      notRepairable: 0,
      rolledBack: 0,
      repairLoops: 0,
      ...overrides,
    },
    tokens: { input: 0, output: 0, context: 0 },
    startedAt: '',
    completedAt: '2026-08-27T10:05:00.000Z',
    activeFindingId: null,
  };
}

beforeEach(() => {
  resetFindingStoreForTests();
  resetArtifactStoreForTests();
  resetRepairStoreForTests();
});

/* ── Health rules (Steps 4–5) ─────────────────────────────────────────── */

describe('project health', () => {
  const stateOf = (entries: ReturnType<typeof computeHealth>, category: string): string =>
    entries.find((entry) => entry.category === category)?.state ?? 'MISSING';

  it('says NOT_RUN for everything when nothing has run', () => {
    const health = computeHealth(null, [], null);
    for (const entry of health) {
      assert.equal(entry.state, 'NOT_RUN', `${entry.category} should be NOT_RUN`);
      assert.ok(entry.detail.length > 0, 'even NOT_RUN carries its sentence');
    }
  });

  it('fails BUILD on a failed compile, warns on lint only', () => {
    const failed = computeHealth(
      validation({
        rows: validation().rows.map((row) =>
          row.name === 'Type Check' ? { ...row, status: 'FAIL' } : row,
        ),
      }),
      [],
      null,
    );
    assert.equal(stateOf(failed, 'BUILD'), 'FAILED');

    const lintOnly = computeHealth(
      validation({
        rows: validation().rows.map((row) =>
          row.name === 'Lint' ? { ...row, status: 'FAIL' } : row,
        ),
      }),
      [],
      null,
    );
    assert.equal(stateOf(lintOnly, 'BUILD'), 'WARNING');
  });

  it('grades findings: critical fails, medium warns, low stays healthy', () => {
    finding({ category: 'SECRETS', severity: 'CRITICAL' });
    finding({ category: 'CORS', severity: 'MEDIUM' });
    const health = computeHealth(
      validation(),
      [finding({ category: 'X', severity: 'LOW', type: 'DEPENDENCY' })],
      null,
    );
    // note: computeHealth reads the passed list, so build it explicitly:
    const all = [
      finding({ category: 'A', severity: 'CRITICAL' }),
      finding({ category: 'B', severity: 'MEDIUM', type: 'DEPENDENCY' }),
      finding({ category: 'C', severity: 'LOW', type: 'CODE_QUALITY' }),
    ];
    const graded = computeHealth(validation(), all, null);
    assert.equal(stateOf(graded, 'SECURITY'), 'FAILED');
    assert.equal(stateOf(graded, 'DEPENDENCIES'), 'WARNING');
    assert.equal(stateOf(graded, 'CODE QUALITY'), 'HEALTHY');
    assert.ok(health.length > 0);
  });

  it('a FIXED finding no longer counts against health', () => {
    const record = finding({ category: 'A', severity: 'CRITICAL' });
    setFindingRepairState(PROJECT, record.id, 'FIXED');
    const health = computeHealth(validation(), [{ ...record, status: 'FIXED' }], null);
    assert.equal(stateOf(health, 'SECURITY'), 'HEALTHY');
  });

  it('marks TESTS blocked when every test was blocked, failed on a critical', () => {
    const blocked = computeHealth(
      validation({
        tests: { total: 5, passed: 0, failed: 0, blocked: 5, skipped: 0, failedCritical: 0 },
      }),
      [],
      null,
    );
    assert.equal(stateOf(blocked, 'TESTS'), 'BLOCKED');

    const critical = computeHealth(
      validation({
        tests: { total: 5, passed: 4, failed: 1, blocked: 0, skipped: 0, failedCritical: 1 },
      }),
      [],
      null,
    );
    assert.equal(stateOf(critical, 'TESTS'), 'FAILED');
  });

  it('warns REPAIRS when anything rolled back or looped', () => {
    const health = computeHealth(validation(), [], repairs({ rolledBack: 1 }));
    assert.equal(stateOf(health, 'REPAIRS'), 'WARNING');
  });
});

/* ── Status (Step 27) ─────────────────────────────────────────────────── */

describe('project status', () => {
  it('derives NOT_RUN, HEALTHY, warnings, and failure from health', () => {
    assert.equal(computeStatus(null, null, computeHealth(null, [], null), []).status, 'NOT_RUN');
    assert.equal(
      computeStatus(null, null, computeHealth(validation(), [], null), []).status,
      'HEALTHY',
    );

    const warned = computeHealth(
      validation({
        tests: { total: 5, passed: 4, failed: 1, blocked: 0, skipped: 0, failedCritical: 0 },
      }),
      [],
      null,
    );
    assert.equal(computeStatus(null, null, warned, []).status, 'HEALTHY_WITH_WARNINGS');

    const failed = computeHealth(
      validation({
        rows: validation().rows.map((row) =>
          row.name === 'Build' ? { ...row, status: 'FAIL' } : row,
        ),
      }),
      [],
      null,
    );
    const verdict = computeStatus(null, null, failed, []);
    assert.equal(verdict.status, 'FAILED');
    assert.match(verdict.reason, /BUILD/);
  });

  it('surfaces REQUIRES_REVIEW when findings await a person', () => {
    const record = finding({ category: 'AUTHENTICATION', severity: 'HIGH' });
    setFindingRepairState(PROJECT, record.id, 'REQUIRES_REVIEW');
    const health = computeHealth(validation(), [], null);
    const verdict = computeStatus(null, null, health, [{ ...record, status: 'REQUIRES_REVIEW' }]);
    assert.equal(verdict.status, 'REQUIRES_REVIEW');
  });
});

/* ── Run history (Steps 16–18) ────────────────────────────────────────── */

describe('run history', () => {
  it('joins artifact summaries by run and leaves the unknowable null', () => {
    writeArtifact({
      projectId: PROJECT,
      runId: 'run-old',
      type: 'validation-summary',
      agentId: 'test-engineer',
      agentVersion: '1',
      derivedFrom: [],
      content: validation({ runId: 'run-old', generatedAt: '2026-08-26T09:00:00.000Z' }),
    });
    const entries = runHistory(PROJECT, []);
    assert.equal(entries.length, 1);
    const [entry] = entries;
    assert.ok(entry);
    assert.equal(entry.runId, 'run-old');
    assert.equal(entry.gate, 'PASSED');
    assert.equal(entry.testsPassed, 9);
    // The run left memory; tokens and agent counts are honestly unknown.
    assert.equal(entry.tokens, null);
    assert.equal(entry.agentsTotal, null);
    assert.equal(entry.status, 'SETTLED');
  });

  it('assembles a full summary with NOT_RUN emptiness, never fake numbers', () => {
    const summary = assembleIntelligence(PROJECT, 'owner-x', null);
    assert.equal(summary.status, 'NOT_RUN');
    assert.equal(summary.findings, null);
    assert.equal(summary.validation, null);
    assert.equal(summary.repairs, null);
    assert.equal(summary.tokens, null);
    assert.equal(summary.graphPreview, null);
    assert.deepEqual(summary.runs, []);
    assert.equal(summary.metrics.graphNodes, null);
  });
});
