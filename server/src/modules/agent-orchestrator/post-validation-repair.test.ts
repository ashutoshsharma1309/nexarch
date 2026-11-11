/**
 * Repair after a verified failure.
 *
 * The session and the re-validation are injected, because the real ones are an
 * npm install and a live server. Everything that decides the outcome is real:
 * which findings qualify, the before-and-after comparison, rollback through the
 * artifact store, and the events that report it.
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { getAgentDefinition } from '../../shared/contracts/index.js';
import {
  listExecutionEvents,
  publishExecutionEvent,
  useExecutionStore,
} from '../execution-events/execution-events.service.js';
import { createMemoryStore } from '../execution-events/lib/event-store.js';
import { latestArtifact, resetArtifactStoreForTests, writeArtifact } from './lib/artifact-store.js';
import {
  publishJobSettled,
  publishJobStarted,
  resetExecutionPublisherForTests,
} from './lib/execution-publisher.js';
import {
  getFinding,
  listFindings,
  recordFinding,
  resetFindingStoreForTests,
  setFindingRepairState,
} from './lib/finding-store.js';
import {
  isImproved,
  repairAfterValidation,
  repairPublishRefusal,
} from './lib/post-validation-repair.js';
import { resetRepairStoreForTests } from './lib/repair-store.js';
import { artifactsOf, createRun, resetStoreForTests, storeArtifacts } from './lib/run-store.js';
import { runnableFiles } from './lib/runnable-project.js';
import type {
  PersistOutcome,
  PostRepairContext,
  PostRepairDeps,
  Revalidation,
} from './lib/post-validation-repair.js';
import type { AgentFinding, AgentResult } from '../../shared/contracts/index.js';
import type { RepairSessionState } from '../../shared/types/repair.js';
import type { ValidationGate, ValidationSummary } from '../../shared/types/validation.js';
import type { AgentRun, AgentTask } from './agent-orchestrator.types.js';

const PROJECT = 'project-1';
const RUN = 'run-1';
const VERSION = 1;

const TYPECHECK: AgentFinding = {
  type: 'RUNTIME',
  severity: 'HIGH',
  category: 'TYPECHECK_FAILURE',
  title: 'npm run typecheck failed in backend',
  description: 'exit 2',
  targetNodeId: null,
  status: 'OPEN',
};

const STARTUP: AgentFinding = { ...TYPECHECK, category: 'STARTUP_FAILURE', title: 'did not start' };

function summary(gate: ValidationGate, failing = 0, testsFailed = 0): ValidationSummary {
  return {
    projectId: PROJECT,
    runId: RUN,
    generatedAt: new Date().toISOString(),
    rows: Array.from({ length: failing }, (_, index) => ({
      name: `Check ${String(index)}`,
      status: 'FAIL' as const,
      detail: '',
    })),
    tests: { total: 1, passed: 0, failed: testsFailed, blocked: 0, skipped: 0, failedCritical: 0 },
    gate,
    gateReason: 'measured',
    agents: [],
  };
}

function runtimeTask(): AgentTask {
  return {
    id: 'task-runtime',
    projectId: PROJECT,
    runId: RUN,
    agentId: 'runtime-engineer',
    status: 'COMPLETED',
    priority: 'NORMAL',
    inputArtifactTypes: [],
    dependencyTaskIds: [],
    startedAt: null,
    completedAt: null,
    durationMs: null,
    error: null,
    failureKind: null,
    retryCount: 0,
    summary: null,
    artifactIds: [],
    usage: null,
    findings: [],
  };
}

function setup(gate: ValidationGate, finding: AgentFinding = TYPECHECK): AgentRun {
  const now = new Date().toISOString();
  const run: AgentRun = {
    id: RUN,
    projectId: PROJECT,
    ownerId: 'owner-1',
    prompt: 'build it',
    status: 'RUNNING',
    tasks: [runtimeTask()],
    currentTaskId: null,
    createdAt: now,
    updatedAt: now,
    error: null,
    totals: { aiCalls: 0, inputTokens: 0, outputTokens: 0, contextTokens: 0, costUsd: 0 },
  };
  createRun(run, new AbortController());

  const content = { files: [{ path: 'src/a.ts', content: 'broken' }] };
  writeSource(content);
  storeArtifacts(RUN, {
    'backend-source': content,
    'validation-summary': summary(gate, gate === 'FAILED' ? 2 : 0),
  });
  recordFinding({
    projectId: PROJECT,
    runId: RUN,
    agentId: 'runtime-engineer',
    reviewVersion: VERSION,
    finding,
  });
  return run;
}

function writeSource(content: unknown): void {
  writeArtifact({
    projectId: PROJECT,
    runId: RUN,
    type: 'backend-source',
    agentId: 'backend-engineer',
    agentVersion: '1',
    derivedFrom: [],
    content,
  });
}

function session(fixed: number): RepairSessionState {
  return {
    id: 'session-1',
    projectId: PROJECT,
    status: 'COMPLETED',
    finalState: 'PASSED',
    stopReason: 'done',
    counts: {
      considered: 1,
      autoRepairable: 1,
      fixed,
      rejected: 0,
      requiresReview: 0,
      notRepairable: 0,
      rolledBack: 0,
      repairLoops: 0,
    },
    tokens: { input: 0, output: 0, context: 0 },
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    activeFindingId: null,
  };
}

/** What the engine does on success: a new file version and a FIXED finding. */
function fixingSession(): PostRepairDeps['runSession'] {
  return (run, repair) => {
    for (const finding of listFindings(PROJECT)) {
      if (repair.selectFindings?.(finding)) setFindingRepairState(PROJECT, finding.id, 'FIXED');
    }
    writeSource({ files: [{ path: 'src/a.ts', content: 'repaired' }] });
    assert.equal(run.id, RUN);
    return Promise.resolve(session(1));
  };
}

function revalidated(
  run: AgentRun,
  after: ValidationSummary,
  findings: AgentFinding[] = [],
): Revalidation {
  const task = run.tasks.find((entry) => entry.agentId === 'runtime-engineer');
  const definition = getAgentDefinition('runtime-engineer');
  assert.ok(task && definition);
  const result: AgentResult = {
    agentId: 'runtime-engineer',
    status: 'succeeded',
    output: null,
    artifacts: {},
    findings,
    error: null,
    failureKind: null,
    durationMs: 5,
    usage: null,
  };
  return { agents: [{ task, definition, result }], summary: after, failure: null };
}

function harness(
  run: AgentRun,
  overrides: Partial<PostRepairDeps> = {},
): {
  context: PostRepairContext;
  deps: PostRepairDeps;
  calls: { commits: number; summaries: number; sessions: number; persists: number };
} {
  const calls = { commits: 0, summaries: 0, sessions: 0, persists: 0 };
  const runSession = overrides.runSession ?? fixingSession();
  const persisted: PersistOutcome = { persisted: true, runId: 'stored-run' };
  return {
    calls,
    context: {
      run,
      reviewVersion: VERSION,
      commit: () => {
        calls.commits += 1;
      },
      resummarize: () => {
        calls.summaries += 1;
        return Promise.resolve();
      },
    },
    deps: {
      runSession: (target, repair) => {
        calls.sessions += 1;
        return runSession(target, repair);
      },
      revalidate:
        overrides.revalidate ?? (() => Promise.resolve(revalidated(run, summary('PASSED')))),
      persist:
        overrides.persist ??
        (() => {
          calls.persists += 1;
          return Promise.resolve(persisted);
        }),
    },
  };
}

function sourceContent(): string | undefined {
  const artifact = artifactsOf(RUN)['backend-source'] as { files: { content: string }[] };
  return artifact.files[0]?.content;
}

/** Publishes are queued per job; awaiting one more drains what came before. */
async function eventsOf(type: string): Promise<{ data: Record<string, unknown> | null }[]> {
  await publishExecutionEvent({
    projectId: PROJECT,
    jobKind: 'RUN',
    jobId: RUN,
    type: 'note',
    message: 'flush',
  });
  return (await listExecutionEvents(RUN)).filter((event) => event.type === type);
}

beforeEach(() => {
  resetStoreForTests();
  resetArtifactStoreForTests();
  resetFindingStoreForTests();
  resetRepairStoreForTests();
  resetExecutionPublisherForTests();
  useExecutionStore(createMemoryStore());
});

describe('when repair runs at all', () => {
  it('does nothing unless validation verified a failure', async () => {
    const run = setup('BLOCKED');
    const { context, deps, calls } = harness(run);
    const outcome = await repairAfterValidation(context, deps);
    assert.equal(outcome.status, 'not-needed');
    assert.equal(calls.sessions, 0);
  });

  it('does nothing after a run was cancelled', async () => {
    const run = setup('FAILED');
    const controller = new AbortController();
    createRun(run, controller);
    storeArtifacts(RUN, { 'validation-summary': summary('FAILED', 2) });
    controller.abort();
    const { context, deps, calls } = harness(run);
    assert.equal((await repairAfterValidation(context, deps)).status, 'not-needed');
    assert.equal(calls.sessions, 0);
  });

  it('leaves a failure with no mechanical fix to a person', async () => {
    const run = setup('FAILED', STARTUP);
    const { context, deps, calls } = harness(run);
    assert.equal((await repairAfterValidation(context, deps)).status, 'no-repair-available');
    assert.equal(calls.sessions, 0);
    assert.equal(run.tasks.length, 1);
  });

  it('ignores findings from an earlier review', async () => {
    const run = setup('FAILED');
    const { context, deps, calls } = harness(run);
    const outcome = await repairAfterValidation({ ...context, reviewVersion: 99 }, deps);
    assert.equal(outcome.status, 'no-repair-available');
    assert.equal(calls.sessions, 0);
  });

  it('offers the engine only the verified failures', async () => {
    const run = setup('FAILED');
    recordFinding({
      projectId: PROJECT,
      runId: RUN,
      agentId: 'dependency-engineer',
      reviewVersion: VERSION,
      finding: { ...TYPECHECK, type: 'DEPENDENCY', category: 'UNUSED_DEPENDENCY', title: 'unused' },
    });
    let offered: string[] = [];
    const { context, deps } = harness(run, {
      runSession: (_run, repair) => {
        offered = listFindings(PROJECT)
          .filter((finding) => repair.selectFindings?.(finding))
          .map((finding) => finding.category);
        return Promise.resolve(session(0));
      },
    });
    await repairAfterValidation(context, deps);
    assert.deepEqual(offered, ['TYPECHECK_FAILURE']);
  });
});

describe('after the engine accepts a patch', () => {
  it('keeps a repair that passes the rebuild and restart, and stores it', async () => {
    const run = setup('FAILED');
    const { context, deps, calls } = harness(run);
    const outcome = await repairAfterValidation(context, deps);

    assert.equal(outcome.status, 'accepted');
    assert.equal(calls.commits, 1);
    assert.equal(calls.summaries, 1);
    assert.equal(calls.persists, 1);
    assert.equal(sourceContent(), 'repaired');
    assert.equal(run.tasks.at(-1)?.agentId, 'repair-engineer');
    assert.equal(run.tasks.at(-1)?.status, 'COMPLETED');

    const [completed] = await eventsOf('repair.completed');
    assert.equal(completed?.data?.repaired, true);
    const [changed] = await eventsOf('files.changed');
    assert.deepEqual(changed?.data?.modified, ['backend/src/a.ts']);
  });

  it('rolls back a repair that did not measurably help', async () => {
    const run = setup('FAILED');
    const { context, deps, calls } = harness(run, {
      revalidate: () => Promise.resolve(revalidated(run, summary('FAILED', 2))),
    });
    const outcome = await repairAfterValidation(context, deps);

    assert.equal(outcome.status, 'rolled-back');
    assert.equal(calls.commits, 0);
    assert.equal(calls.persists, 0);
    assert.equal(sourceContent(), 'broken');
    const latest = latestArtifact(PROJECT, 'backend-source')?.content as {
      files: { content: string }[];
    };
    assert.equal(latest.files[0]?.content, 'broken');
    assert.equal(listFindings(PROJECT)[0]?.status, 'REJECTED');
    const [completed] = await eventsOf('repair.completed');
    assert.equal(completed?.data?.repaired, false);
  });

  it('rolls back when the re-validation could not finish', async () => {
    const run = setup('FAILED');
    const { context, deps, calls } = harness(run, {
      revalidate: () =>
        Promise.resolve({ agents: [], summary: null, failure: 'Runtime Engineer timed out' }),
    });
    const outcome = await repairAfterValidation(context, deps);
    assert.equal(outcome.status, 'rolled-back');
    assert.match(outcome.detail, /timed out/);
    assert.equal(calls.persists, 0);
    assert.equal(sourceContent(), 'broken');
  });

  it('rolls back and closes the task when re-validation throws', async () => {
    const run = setup('FAILED');
    const { context, deps } = harness(run, {
      revalidate: () => Promise.reject(new Error('runner fell over')),
    });
    const outcome = await repairAfterValidation(context, deps);
    assert.equal(outcome.status, 'rolled-back');
    assert.equal(sourceContent(), 'broken');
    assert.equal(
      run.tasks.some((task) => task.status === 'RUNNING'),
      false,
    );
    await eventsOf('note');
  });

  it('does not leave the repair task running when a late step throws', async () => {
    const run = setup('FAILED');
    const { context, deps } = harness(run);
    context.resummarize = () => Promise.reject(new Error('summary failed'));
    await assert.rejects(repairAfterValidation(context, deps), /summary failed/);
    const task = run.tasks.find((entry) => entry.agentId === 'repair-engineer');
    assert.equal(task?.status, 'FAILED');
    await eventsOf('note');
  });

  it('reports a store that threw as a refusal, not a crash', async () => {
    const run = setup('FAILED');
    const { context, deps } = harness(run, {
      persist: () => Promise.reject(new Error('no such project')),
    });
    const outcome = await repairAfterValidation(context, deps);
    assert.ok(outcome.status === 'accepted' && outcome.persist?.persisted === false);
    await eventsOf('note');
  });

  it('keeps an improvement but holds it back from Preview while the gate fails', async () => {
    const run = setup('FAILED');
    const { context, deps, calls } = harness(run, {
      revalidate: () => Promise.resolve(revalidated(run, summary('FAILED', 1))),
    });
    const outcome = await repairAfterValidation(context, deps);
    assert.equal(outcome.status, 'accepted');
    assert.equal(calls.persists, 0);
    assert.equal(sourceContent(), 'repaired');
    const [completed] = await eventsOf('repair.completed');
    assert.equal(completed?.data?.repaired, false);
  });

  it('does not call a finding fixed when the re-validation saw it again', async () => {
    const run = setup('FAILED');
    const { context, deps } = harness(run, {
      revalidate: () => Promise.resolve(revalidated(run, summary('FAILED', 1), [TYPECHECK])),
    });
    await repairAfterValidation(context, deps);
    const id = listFindings(PROJECT)[0]?.id ?? '';
    assert.equal(getFinding(PROJECT, id)?.status, 'REJECTED');
  });

  it('does not re-validate when no patch survived', async () => {
    const run = setup('FAILED');
    let revalidations = 0;
    const { context, deps } = harness(run, {
      runSession: () => Promise.resolve(session(0)),
      revalidate: () => {
        revalidations += 1;
        return Promise.resolve(revalidated(run, summary('PASSED')));
      },
    });
    assert.equal((await repairAfterValidation(context, deps)).status, 'nothing-fixed');
    assert.equal(revalidations, 0);
  });

  it('reports a store that refused the files instead of claiming they arrived', async () => {
    const run = setup('FAILED');
    const { context, deps } = harness(run, {
      persist: () => Promise.resolve({ persisted: false, reason: 'no stored build' }),
    });
    const outcome = await repairAfterValidation(context, deps);
    assert.ok(outcome.status === 'accepted' && outcome.persist?.persisted === false);
    const notes = await eventsOf('note');
    assert.ok(notes.some((note) => note.data?.error === 'no stored build'));
  });
});

describe('whether a repair may replace the latest version', () => {
  const clean = {
    basedOnRunId: 'r1',
    latestRunId: 'r1',
    activeJob: false,
    latestWasChanged: false,
  };

  it('allows the build this run started beside', () => {
    assert.equal(repairPublishRefusal(clean), null);
  });

  it('refuses while an edit or enhancement is running', () => {
    assert.match(repairPublishRefusal({ ...clean, activeJob: true }) ?? '', /is running/);
  });

  it('refuses when a newer version landed during the run', () => {
    assert.match(repairPublishRefusal({ ...clean, latestRunId: 'r2' }) ?? '', /changed while/);
  });

  it('refuses when the starting build could not be read', () => {
    assert.match(
      repairPublishRefusal({ ...clean, basedOnRunId: undefined }) ?? '',
      /changed while/,
    );
  });

  it('refuses when there was no build at the start and one exists now', () => {
    assert.match(repairPublishRefusal({ ...clean, basedOnRunId: null }) ?? '', /changed while/);
  });

  it('refuses to replace edits or enhancements the mesh never saw', () => {
    assert.match(
      repairPublishRefusal({ ...clean, latestWasChanged: true }) ?? '',
      /do not include/,
    );
  });
});

describe('a resumed run', () => {
  const allEvents = async (jobId: string) => {
    await publishExecutionEvent({
      projectId: PROJECT,
      jobKind: 'RUN',
      jobId,
      type: 'note',
      message: 'flush',
    });
    return listExecutionEvents(jobId);
  };

  it('gets its own timeline, so the first one can stay ended', async () => {
    const run = setup('FAILED');
    publishJobStarted(run);
    publishJobSettled(run, 'FAILED', 1);
    assert.equal(run.executionJobId, undefined);

    publishJobStarted(run);
    publishJobSettled(run, 'COMPLETED', 1);
    const resumedId = (run as { executionJobId?: string }).executionJobId ?? '';
    assert.ok(resumedId !== '' && resumedId !== run.id);

    const first = (await allEvents(run.id)).map((event) => event.type);
    assert.equal(first.includes('job.completed'), false);
    assert.equal(first.filter((type) => type === 'job.failed').length, 1);

    const second = (await allEvents(resumedId)).map((event) => event.type);
    assert.equal(second[0], 'job.started');
    assert.equal(second.includes('job.completed'), true);
  });
});

describe('isImproved', () => {
  it('accepts a better gate with no new failures', () => {
    assert.equal(isImproved(summary('FAILED', 2), summary('PASSED')), true);
    assert.equal(isImproved(summary('FAILED', 2), summary('BLOCKED', 1)), true);
  });

  it('refuses a better gate that added failures', () => {
    assert.equal(isImproved(summary('FAILED', 1), summary('BLOCKED', 2)), false);
  });

  it('accepts the same gate only with fewer failures', () => {
    assert.equal(isImproved(summary('FAILED', 3), summary('FAILED', 2)), true);
    assert.equal(isImproved(summary('FAILED', 2), summary('FAILED', 2)), false);
  });

  it('refuses a worse gate', () => {
    assert.equal(isImproved(summary('BLOCKED', 0), summary('FAILED', 0)), false);
  });

  it('counts failed tests', () => {
    assert.equal(isImproved(summary('FAILED', 1, 3), summary('FAILED', 1, 1)), true);
  });
});

describe('the file set handed to Preview', () => {
  it('is assembled from the repaired artifacts', async () => {
    const run = setup('FAILED');
    const { context, deps } = harness(run);
    await repairAfterValidation(context, deps);
    assert.deepEqual(runnableFiles(artifactsOf(RUN)), [
      { path: 'backend/src/a.ts', content: 'repaired' },
    ]);
  });
});
