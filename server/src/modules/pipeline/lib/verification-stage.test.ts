import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { verifyAndRepair } from '../pipeline.service.js';
import { declaredRoutes, hasVerifiedFailure, mergeRepairedFiles } from './verification-stage.js';
import type { VerificationDeps } from './verification-stage.js';
import type {
  RepairResult,
  VerificationResult,
} from '../../build-verification/build-verification.types.js';
import type { PipelineArtifacts, PipelineRun, PipelineStage } from '../pipeline.types.js';

function result(ok: boolean, statuses: Record<string, string> = {}): VerificationResult {
  return {
    ok,
    steps: Object.entries(statuses).map(([id, status]) => ({
      id,
      status,
      summary: `${id} ${status}`,
    })),
    routes: [],
    limitations: ['no browser check'],
    startedAt: '',
    completedAt: '',
    durationMs: 1,
  } as unknown as VerificationResult;
}

function stage(id: string): PipelineStage {
  return {
    id,
    label: id,
    status: 'pending',
    engine: 'deterministic',
    agentId: 'runtime-engineer',
    startedAt: null,
    completedAt: null,
    durationMs: null,
    summary: null,
    error: null,
    degraded: false,
  } as PipelineStage;
}

function makeRun(projectId: string | null = 'project-1'): PipelineRun {
  return {
    id: 'run-1',
    projectId,
    projectName: 'P',
    prompt: 'x',
    status: 'running',
    stages: [stage('verification'), stage('repair')],
    ai: {
      calls: 0,
      provider: 'none',
      model: 'none',
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
    },
    createdAt: '',
    updatedAt: '',
    error: null,
  };
}

const artifacts = (): PipelineArtifacts =>
  ({
    backend: { files: [{ path: 'src/a.ts', content: 'broken', language: 'typescript' }] },
    frontend: { files: [{ path: 'src/b.tsx', content: 'fine', language: 'typescript' }] },
    security: {
      backendFiles: [{ path: 'src/auth.ts', content: 'guard', language: 'typescript' }],
      frontendFiles: [],
    },
    files: [
      { path: 'backend/src/a.ts', content: 'broken' },
      { path: 'backend/src/auth.ts', content: 'guard' },
      { path: 'frontend/src/b.tsx', content: 'fine' },
    ],
  }) as unknown as PipelineArtifacts;

const statusOf = (run: PipelineRun, id: string): string | undefined =>
  run.stages.find((entry) => entry.id === id)?.status;

function deps(
  verify: () => Promise<VerificationResult>,
  repair?: () => Promise<RepairResult>,
): VerificationDeps {
  return {
    verifyProject: verify,
    repairVerifiedFailures:
      repair ?? ((): Promise<RepairResult> => Promise.reject(new Error('repair must not run'))),
  };
}

describe('verify and repair', () => {
  it('skips with a reason when the run has no project', async () => {
    const run = makeRun(null);
    const out = await verifyAndRepair(
      run,
      artifacts(),
      [],
      deps(() => Promise.reject(new Error('must not run'))),
    );
    assert.equal(statusOf(run, 'verification'), 'skipped');
    assert.equal(out.verification, undefined);
  });

  it('records a pass and never starts a repair', async () => {
    const run = makeRun();
    const out = await verifyAndRepair(
      run,
      artifacts(),
      [],
      deps(() => Promise.resolve(result(true, { build: 'passed' }))),
    );
    assert.equal(statusOf(run, 'verification'), 'completed');
    assert.equal(statusOf(run, 'repair'), 'skipped');
    assert.equal(out.verification?.result.ok, true);
    assert.equal(out.verification.repaired, false);
  });

  it('saves repaired files where an edit will find them, and keeps the failure on record', async () => {
    const run = makeRun();
    const fixed = [
      { path: 'backend/src/a.ts', content: 'fixed' },
      { path: 'backend/src/auth.ts', content: 'guard2' },
      { path: 'frontend/src/b.tsx', content: 'fine' },
      { path: 'frontend/src/new.ts', content: 'added' },
    ];
    const out = await verifyAndRepair(
      run,
      artifacts(),
      [],
      deps(
        () => Promise.resolve(result(false, { build: 'failed' })),
        () =>
          Promise.resolve({
            repaired: true,
            files: fixed,
            verification: result(true, { build: 'passed' }),
            attempts: [
              {
                attempt: 1,
                targets: [],
                changedFiles: ['backend/src/a.ts'],
                verification: result(true),
              },
            ],
            limitations: [],
            usage: [],
          }),
      ),
    );
    assert.equal(statusOf(run, 'verification'), 'failed');
    assert.equal(statusOf(run, 'repair'), 'completed');
    assert.equal(out.verification?.repaired, true);
    assert.equal(out.backend.files.find((f) => f.path === 'src/a.ts')?.content, 'fixed');
    assert.equal(
      out.security.backendFiles.find((f) => f.path === 'src/auth.ts')?.content,
      'guard2',
    );
    assert.ok(out.frontend.files.some((f) => f.path === 'src/new.ts'));
    assert.equal(out.files.find((f) => f.path === 'backend/src/a.ts')?.content, 'fixed');
  });

  it('reports a failed repair as failed and keeps the best files', async () => {
    const run = makeRun();
    const still = result(false, { build: 'failed' });
    const out = await verifyAndRepair(
      run,
      artifacts(),
      [],
      deps(
        () => Promise.resolve(still),
        () =>
          Promise.resolve({
            repaired: false,
            files: artifacts().files,
            verification: still,
            attempts: [],
            usage: [],
            limitations: ['gave up'],
          }),
      ),
    );
    assert.equal(statusOf(run, 'repair'), 'failed');
    assert.equal(out.verification?.repaired, false);
    assert.equal(out.verification.result.ok, false);
    assert.ok(out.verification.limitations.includes('gave up'));
  });

  it('does not repair what was only blocked', async () => {
    const run = makeRun();
    await verifyAndRepair(
      run,
      artifacts(),
      [],
      deps(() => Promise.resolve(result(false, { build: 'blocked' }))),
    );
    assert.equal(statusOf(run, 'verification'), 'failed');
    assert.equal(statusOf(run, 'repair'), 'skipped');
  });

  it('never claims a result when verification could not run at all', async () => {
    const run = makeRun();
    const out = await verifyAndRepair(
      run,
      artifacts(),
      [],
      deps(() => Promise.reject(new Error('no runner'))),
    );
    assert.equal(statusOf(run, 'verification'), 'failed');
    assert.equal(statusOf(run, 'repair'), 'skipped');
    assert.equal(out.verification, undefined);
  });
});

describe('verification helpers', () => {
  it('declares only id-free GET routes, and expects guarded ones to refuse', () => {
    assert.deepEqual(
      declaredRoutes([
        { method: 'GET', path: '/api/v1/items', auth: false },
        { method: 'GET', path: '/api/v1/items/:id', auth: false },
        { method: 'POST', path: '/api/v1/items', auth: false },
        { method: 'GET', path: '/api/v1/secret', auth: true },
      ]),
      [
        { method: 'GET', path: '/api/v1/items' },
        { method: 'GET', path: '/api/v1/secret', expectedStatus: 401 },
      ],
    );
  });

  it('counts a failed route as a verified failure', () => {
    const value = {
      ...result(false),
      routes: [{ status: 'failed' }],
    } as unknown as VerificationResult;
    assert.equal(hasVerifiedFailure(value), true);
    assert.equal(hasVerifiedFailure(result(false, { start: 'blocked' })), false);
  });

  it('drops a file the repair deleted from every part', () => {
    const merged = mergeRepairedFiles(artifacts(), [
      { path: 'frontend/src/b.tsx', content: 'fine' },
    ]);
    assert.deepEqual(merged.backend.files, []);
    assert.deepEqual(merged.security.backendFiles, []);
  });
});
