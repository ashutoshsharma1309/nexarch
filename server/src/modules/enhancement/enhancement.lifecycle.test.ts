/**
 * The lifecycle against stubbed builds, models and an in-memory job store.
 *
 * These prove the outcomes a real run can only produce by bad luck: a failed
 * build, a repair that strays outside the plan, a cancel mid-run, a project
 * that moved underneath a plan.
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import {
  applyEnhancement,
  cancelEnhancement,
  planEnhancement,
  resetEnhancementStateForTests,
  revertEnhancement,
} from './lib/orchestrator.js';
import { restoreUnplanned } from './lib/worker.js';
import type { EnhancementDeps } from './lib/deps.js';
import type { EnhancementResult } from './enhancement.types.js';
import type { EditJob } from '../project-editor/lib/edit-job-store.js';
import type { PipelineArtifacts, PipelineStage } from '../pipeline/pipeline.types.js';
import type { VerificationResult } from '../build-verification/index.js';

const OWNER = 'owner-1';
const PROJECT = 'project-1';

const verification = (ok: boolean): VerificationResult => ({
  ok,
  steps: [
    {
      id: 'build',
      status: ok ? 'passed' : 'failed',
      command: 'npm run build',
      exitCode: ok ? 0 : 1,
      durationMs: 5,
      summary: ok ? 'built' : 'did not build',
      output: '',
      reason: null,
    },
  ],
  routes: [],
  limitations: [],
  startedAt: '',
  completedAt: '',
  durationMs: 5,
});

const artifactsOf = (content: string): PipelineArtifacts =>
  ({
    requirements: { projectName: 'Cafe', projectType: 'site', goal: 'a cafe', modules: [] },
    files: [
      { path: 'frontend/src/home.tsx', content },
      { path: 'backend/src/app.ts', content: 'export const app = 1;\n' },
    ],
  }) as unknown as PipelineArtifacts;

interface Harness {
  deps: EnhancementDeps;
  jobs: Map<string, EditJob>;
  events: { type: string; jobId: string; stage?: string }[];
  runs: Map<string, PipelineArtifacts>;
  stages: PipelineStage[];
  state: {
    latestRun: string;
    verifyResults: VerificationResult[];
    repaired: { path: string; content: string }[] | null;
    beforeImplement: () => void;
  };
}

function harness(): Harness {
  const jobs = new Map<string, EditJob>();
  const events: Harness['events'] = [];
  const stages: PipelineStage[] = [];
  const runs = new Map([['run-0', artifactsOf('export const v = 0;\n')]]);
  const state: Harness['state'] = {
    latestRun: 'run-0',
    verifyResults: [],
    repaired: null,
    beforeImplement: () => undefined,
  };
  let counter = 0;

  const generate = (request: { promptId: string }) => {
    if (request.promptId === 'enhance-implement') state.beforeImplement();
    return Promise.resolve({
      content:
        request.promptId === 'enhance-plan'
          ? JSON.stringify({
              summary: 'Change the home page',
              steps: ['Edit home'],
              files: [
                { path: 'frontend/src/home.tsx', action: 'modify', reason: 'it is the page' },
              ],
            })
          : JSON.stringify({ edits: [{ find: 'v = 0', replace: 'v = 1' }], summary: 'done' }),
      record: {
        provider: 'mock',
        model: 'mock-1',
        tokens: { inputTokens: 10, outputTokens: 5 },
        cost: { totalCostUsd: 0.01 },
        durationMs: 3,
        cacheHit: false,
      },
      contextPackage: null,
      compression: null,
    });
  };

  const store: EnhancementDeps['store'] = {
    ActiveEditExists: class extends Error {},
    activeJobFor: (projectId) =>
      Promise.resolve(
        [...jobs.values()].find(
          (job) => job.projectId === projectId && ['QUEUED', 'RUNNING'].includes(job.status),
        ) ?? null,
      ),
    createJob: (input) => {
      if ([...jobs.values()].some((job) => ['QUEUED', 'RUNNING'].includes(job.status))) {
        return Promise.reject(new store.ActiveEditExists('busy'));
      }
      counter += 1;
      const job = {
        ...input,
        id: `job-${String(counter)}`,
        kind: input.kind ?? 'EDIT',
        cancelRequested: false,
        status: 'QUEUED',
        stage: 'queued',
        stages: [],
        result: null,
        error: null,
        runId: null,
        startedAt: null,
        completedAt: null,
        createdAt: '',
        updatedAt: '',
      } as EditJob;
      jobs.set(job.id, job);
      return Promise.resolve(job);
    },
    advanceStage: (jobId, stage) => {
      const job = jobs.get(jobId);
      if (job) Object.assign(job, { status: 'RUNNING', stage });
      return Promise.resolve();
    },
    finishJob: (jobId, outcome) => {
      const job = jobs.get(jobId);
      if (job) {
        Object.assign(job, {
          status: outcome.status,
          result: outcome.result ?? null,
          runId: outcome.runId ?? null,
          error: outcome.error ?? null,
        });
      }
      return Promise.resolve(job !== undefined);
    },
    getJob: (jobId, ownerId) => {
      const job = jobs.get(jobId);
      return Promise.resolve(job?.ownerId === ownerId ? job : null);
    },
    heartbeat: () => Promise.resolve(),
    isCancelRequested: (jobId) => Promise.resolve(jobs.get(jobId)?.cancelRequested ?? false),
    latestJobFor: () => Promise.resolve(null),
    requestCancel: (jobId) => {
      const job = jobs.get(jobId);
      if (!job || !['QUEUED', 'RUNNING'].includes(job.status)) return Promise.resolve(false);
      job.cancelRequested = true;
      return Promise.resolve(true);
    },
  };

  const deps = {
    generate,
    research: () => Promise.reject(new Error('no research in this test')),
    formatBrief: () => '',
    researchConfigured: () => false,
    buildContext: () => Promise.resolve({ text: 'architecture' }),
    impact: (_owner: string, _project: string, paths: string[]) =>
      Promise.resolve({
        direct: paths,
        dependents: [],
        tests: [],
        graphUnavailable: false,
        graphUnavailableReason: null,
      }),
    verify: () => Promise.resolve(state.verifyResults.shift() ?? verification(true)),
    repair: (files: { path: string; content: string }[], result: VerificationResult) => {
      const verdict = state.verifyResults.shift() ?? result;
      return Promise.resolve({
        repaired: verdict.ok,
        files: state.repaired ?? files,
        verification: verdict,
        attempts: [{ attempt: 1, targets: [], changedFiles: [], verification: verdict }],
        limitations: [],
        usage: [
          {
            provider: 'mock',
            model: 'repair-1',
            inputTokens: 4,
            outputTokens: 2,
            costUsd: null,
            durationMs: 1,
            cacheHit: false,
          },
        ],
      });
    },
    validate: () => Promise.reject(new Error('no live checks in this test')),
    stop: () => undefined,
    runChecks: () => Promise.resolve([]),
    project: () => Promise.resolve({ name: 'Cafe' }),
    baseline: () =>
      Promise.resolve({ runId: state.latestRun, artifacts: runs.get(state.latestRun) }),
    latestRunId: () => Promise.resolve(state.latestRun),
    loadRun: (runId: string) => Promise.resolve(runs.get(runId) ?? null),
    registerRun: (input: { artifacts: PipelineArtifacts; stages: PipelineStage[] }) => {
      const id = `run-${String(runs.size)}`;
      stages.push(...input.stages);
      runs.set(id, input.artifacts);
      state.latestRun = id;
      return Promise.resolve({ run: { id }, persisted: true });
    },
    syncGraph: () => Promise.resolve(),
    publish: (event: { type: string; jobId: string; stage?: string }) => {
      events.push({
        type: event.type,
        jobId: event.jobId,
        ...(event.stage ? { stage: event.stage } : {}),
      });
      return Promise.resolve(null);
    },
    recordUsage: () => Promise.resolve(null),
    store,
  } as unknown as EnhancementDeps;

  return { deps, jobs, events, runs, state, stages };
}

async function settled(h: Harness, jobId: string): Promise<EditJob> {
  for (let tries = 0; tries < 200; tries += 1) {
    const job = h.jobs.get(jobId);
    if (job && !['QUEUED', 'RUNNING'].includes(job.status)) {
      await new Promise((resolve) => setImmediate(resolve));
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error('the job never settled');
}

const input = { projectId: PROJECT, ownerId: OWNER, instruction: 'change the home page copy' };

async function applied(h: Harness) {
  const plan = await planEnhancement(input, h.deps);
  const job = await applyEnhancement(
    { projectId: PROJECT, ownerId: OWNER, planId: plan.planId },
    h.deps,
  );
  return { plan, job };
}

const terminals = (h: Harness, jobId: string) =>
  h.events.filter(
    (event) => event.jobId === jobId && /^job\.(completed|failed|cancelled)/.exec(event.type),
  );

describe('enhancement lifecycle', () => {
  let h: Harness;

  beforeEach(() => {
    resetEnhancementStateForTests();
    h = harness();
  });

  it('applies a verified change and reports exactly what changed', async () => {
    const { job } = await applied(h);
    const done = await settled(h, job.id);
    assert.equal(done.status, 'SUCCEEDED');
    assert.equal(h.state.latestRun, done.runId);
    const result = done.result as EnhancementResult;
    assert.deepEqual(
      result.changedFiles.map((file) => file.path),
      ['frontend/src/home.tsx'],
    );
    assert.equal(result.baseRunId, 'run-0');
    assert.equal(result.usage.calls, 2);
    assert.equal(terminals(h, job.id).length, 1);
    const stored = h.runs.get(String(done.runId));
    assert.match(
      stored?.files.find((file) => file.path === 'frontend/src/home.tsx')?.content ?? '',
      /v = 1/,
    );
  });

  it('rejects a change that does not build and leaves the project alone', async () => {
    h.state.verifyResults = [verification(false), verification(false)];
    const { job } = await applied(h);
    const done = await settled(h, job.id);
    assert.equal(done.status, 'REJECTED');
    assert.equal(h.state.latestRun, 'run-0');
    assert.equal((done.result as EnhancementResult).rolledBack, true);
    assert.equal(terminals(h, job.id)[0]?.type, 'job.failed');
  });

  it('accepts a change a repair really fixed', async () => {
    h.state.verifyResults = [verification(false), verification(true)];
    const { job } = await applied(h);
    const done = await settled(h, job.id);
    assert.equal(done.status, 'SUCCEEDED');
    const result = done.result as EnhancementResult;
    assert.equal(result.repair.repaired, true);
    // Plan, implement, and the repair's own call.
    assert.equal(result.usage.calls, 3);
    assert.equal(result.usage.inputTokens, 24);
  });

  it('stores the verdict for these files and its own stage identity', async () => {
    const { job } = await applied(h);
    const done = await settled(h, job.id);
    const stored = h.runs.get(String(done.runId));
    assert.equal(stored?.verification?.result.ok, true);
    assert.deepEqual(
      h.stages.map((stage) => [stage.id, stage.agentId]),
      [['enhancement', 'enhancement-engineer']],
    );
  });

  it('discards its result when the job was settled elsewhere while it ran', async () => {
    // After the last stage change, which is what the fake store resets status on.
    const verify = h.deps.verify;
    h.deps.verify = async (...args) => {
      const result = await verify(...args);
      const running = [...h.jobs.values()][0];
      if (running) Object.assign(running, { status: 'INTERRUPTED' });
      return result;
    };
    const { job } = await applied(h);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(h.state.latestRun, 'run-0');
    assert.equal(terminals(h, job.id).length, 0);
  });

  it('does not report a repair that failed as a finished stage', async () => {
    h.state.verifyResults = [verification(false), verification(false), verification(false)];
    h.state.repaired = [
      { path: 'frontend/src/home.tsx', content: 'export const v = 1;\n' },
      { path: 'backend/src/app.ts', content: 'export const app = 2;\n' },
    ];
    const { job } = await applied(h);
    await settled(h, job.id);
    const repairing = h.events.filter((event) => event.stage === 'repairing');
    assert.ok(repairing.some((event) => event.type === 'stage.failed'));
    assert.ok(!repairing.some((event) => event.type === 'stage.completed'));
  });

  it('re-verifies after putting back what a repair changed outside the plan', async () => {
    h.state.verifyResults = [verification(false), verification(true), verification(false)];
    h.state.repaired = [
      { path: 'frontend/src/home.tsx', content: 'export const v = 1;\n' },
      { path: 'backend/src/app.ts', content: 'export const app = 2;\n' },
    ];
    const { job } = await applied(h);
    const done = await settled(h, job.id);
    const result = done.result as EnhancementResult;
    assert.equal(done.status, 'REJECTED');
    assert.deepEqual(result.repair.restoredUnplannedFiles, ['backend/src/app.ts']);
  });

  it('honours a cancel at the next step boundary', async () => {
    h.state.beforeImplement = () => {
      for (const job of h.jobs.values()) job.cancelRequested = true;
    };
    h.state.verifyResults = [verification(true)];
    const { job } = await applied(h);
    const done = await settled(h, job.id);
    assert.equal(done.status, 'CANCELLED');
    assert.equal(h.state.latestRun, 'run-0');
    assert.equal(terminals(h, job.id)[0]?.type, 'job.cancelled');
  });

  it('refuses to cancel a job that has ended', async () => {
    const { job } = await applied(h);
    await settled(h, job.id);
    await assert.rejects(
      cancelEnhancement({ projectId: PROJECT, ownerId: OWNER, jobId: job.id }, h.deps),
      /already finished/,
    );
  });

  it('refuses a plan the project has moved past', async () => {
    const plan = await planEnhancement(input, h.deps);
    h.state.latestRun = 'run-newer';
    await assert.rejects(
      applyEnhancement({ projectId: PROJECT, ownerId: OWNER, planId: plan.planId }, h.deps),
      /changed since/,
    );
  });

  it('does not overwrite a rebuild that finished during the run', async () => {
    h.state.beforeImplement = () => {
      h.state.latestRun = 'run-newer';
    };
    const { job } = await applied(h);
    const done = await settled(h, job.id);
    assert.equal(done.status, 'REJECTED');
    assert.equal(h.state.latestRun, 'run-newer');
  });

  it('turns a concurrent apply into a conflict through the job slot', async () => {
    const first = await planEnhancement(input, h.deps);
    const second = await planEnhancement(input, h.deps);
    h.state.beforeImplement = () => undefined;
    const job = await applyEnhancement(
      { projectId: PROJECT, ownerId: OWNER, planId: first.planId },
      h.deps,
    );
    await assert.rejects(
      applyEnhancement({ projectId: PROJECT, ownerId: OWNER, planId: second.planId }, h.deps),
      /already running/,
    );
    await settled(h, job.id);
  });

  it("hides another owner's plan", async () => {
    const plan = await planEnhancement(input, h.deps);
    await assert.rejects(
      applyEnhancement({ projectId: PROJECT, ownerId: 'someone', planId: plan.planId }, h.deps),
      /no longer available/,
    );
  });

  it('reverts as a new version and can be undone', async () => {
    const { job } = await applied(h);
    const done = await settled(h, job.id);
    const reverted = await revertEnhancement(
      { projectId: PROJECT, ownerId: OWNER, jobId: job.id },
      h.deps,
    );
    assert.equal(reverted.restoredRunId, 'run-0');
    assert.notEqual(reverted.runId, done.runId);
    assert.equal(h.runs.has(String(done.runId)), true);
    const stored = h.runs.get(reverted.runId);
    assert.match(stored?.files[0]?.content ?? '', /v = 0/);
    assert.equal(h.events.filter((event) => event.type === 'enhancement.reverted').length, 1);
  });

  it('refuses to revert past later changes', async () => {
    const { job } = await applied(h);
    await settled(h, job.id);
    h.state.latestRun = 'run-later';
    await assert.rejects(
      revertEnhancement({ projectId: PROJECT, ownerId: OWNER, jobId: job.id }, h.deps),
      /no longer the latest/,
    );
  });

  it('refuses to apply authentication with no live check planned', async () => {
    const plan = await planEnhancement(
      { projectId: PROJECT, ownerId: OWNER, instruction: 'add login to this site' },
      h.deps,
    );
    assert.ok(plan.limitations.some((line) => line.includes('cannot be applied')));
    await assert.rejects(
      applyEnhancement({ projectId: PROJECT, ownerId: OWNER, planId: plan.planId }, h.deps),
      /does not cover/,
    );
  });
});

describe('restoreUnplanned', () => {
  const baseline = [
    { path: 'a.ts', content: '1' },
    { path: 'b.ts', content: '1' },
  ];

  it('keeps planned changes and puts back everything else', () => {
    const { workspace, restored } = restoreUnplanned(new Set(['a.ts']), baseline, [
      { path: 'a.ts', content: '2' },
      { path: 'b.ts', content: '2' },
      { path: 'c.ts', content: 'new' },
    ]);
    assert.equal(workspace.get('a.ts'), '2');
    assert.equal(workspace.get('b.ts'), '1');
    assert.equal(workspace.has('c.ts'), false);
    assert.deepEqual(restored.sort(), ['b.ts', 'c.ts']);
  });

  it('restores an unplanned file a repair deleted', () => {
    const { workspace, restored } = restoreUnplanned(new Set(['a.ts']), baseline, [
      { path: 'a.ts', content: '2' },
    ]);
    assert.equal(workspace.get('b.ts'), '1');
    assert.deepEqual(restored, ['b.ts']);
  });
});
