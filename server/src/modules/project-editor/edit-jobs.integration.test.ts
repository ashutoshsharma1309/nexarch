/**
 * Edit-job lifecycle integration tests (`npm run test:integration`).
 *
 * These need a real database because the job row *is* the feature: applying
 * an edit takes five or six minutes, so the work outlives the request that
 * asked for it, and the row is the only thing a reloaded page, a second tab,
 * or a restarted server can read to find out what happened.
 *
 * The cases are the ones that bite in practice — a duplicate submission, a
 * reload mid-edit, and a process that dies half way — rather than a tour of
 * the happy path, which the end-to-end run already covers.
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import { prisma } from '../../shared/database/prisma.js';
import {
  activeJobFor,
  advanceStage,
  createJob,
  finishJob,
  getJob,
  isTerminal,
  latestJobFor,
  reconcileInterruptedJobs,
} from './lib/edit-job-store.js';
import type { EditResult } from './project-editor.types.js';

const OWNER = 'edit_job_owner_a';
const INTRUDER = 'edit_job_owner_b';
let projectId = '';

function result(status: EditResult['status']): EditResult {
  return {
    planId: 'plan-1',
    projectId,
    status,
    runId: status === 'applied' ? 'run-1' : null,
    changedFiles: [],
    unchangedFileCount: 180,
    validation: {
      checks: [],
      startedUp: status === 'applied',
      frontendUrl: null,
      backendUrl: null,
    },
    outcome: status === 'applied' ? 'applied' : 'discarded',
    rolledBack: status !== 'applied',
    completedAt: new Date().toISOString(),
  };
}

before(async () => {
  const role = await prisma.role.upsert({
    where: { name: 'USER' },
    update: {},
    create: { name: 'USER', description: 'Standard platform access' },
  });
  for (const [id, email] of [
    [OWNER, 'edit-job-a@integration.test'],
    [INTRUDER, 'edit-job-b@integration.test'],
  ] as const) {
    await prisma.user.upsert({
      where: { id },
      update: {},
      create: { id, email, name: `Edit ${id}`, roleId: role.id },
    });
  }
  await prisma.project.deleteMany({ where: { ownerId: { in: [OWNER, INTRUDER] } } });
  const project = await prisma.project.create({
    data: { ownerId: OWNER, name: 'Edit Job Test', slug: 'edit-job-test', status: 'ACTIVE' },
  });
  projectId = project.id;
});

beforeEach(async () => {
  await prisma.editJob.deleteMany({ where: { projectId } });
});

after(async () => {
  await prisma.project.deleteMany({ where: { ownerId: { in: [OWNER, INTRUDER] } } });
  await prisma.user.deleteMany({ where: { id: { in: [OWNER, INTRUDER] } } });
  await prisma.$disconnect();
});

const newJob = () =>
  createJob({ projectId, ownerId: OWNER, planId: 'plan-1', instruction: 'make the hero warmer' });

describe('edit jobs', () => {
  it('starts queued, with the first stage already open', async () => {
    const job = await newJob();
    assert.equal(job.status, 'QUEUED');
    assert.equal(job.stage, 'queued');
    assert.equal(job.stages.length, 1);
    assert.equal(job.stages[0]?.completedAt, null, 'the open stage has no end yet');
    assert.equal(job.result, null);
  });

  it('measures each stage rather than reporting a guess', async () => {
    const job = await newJob();
    await advanceStage(job.id, 'rebuilding');
    await advanceStage(job.id, 'validating', '2 files rebuilt');

    const seen = await getJob(job.id, OWNER);
    assert.ok(seen);
    assert.equal(seen.status, 'RUNNING');
    assert.equal(seen.stage, 'validating');
    assert.deepEqual(
      seen.stages.map((entry) => entry.stage),
      ['queued', 'rebuilding', 'validating'],
    );
    // Every stage but the current one is closed, and the closed ones carry
    // both ends so elapsed time is subtraction, not animation.
    const [queued, rebuilding, validating] = seen.stages;
    assert.ok(queued?.completedAt);
    assert.ok(rebuilding?.completedAt);
    assert.equal(rebuilding.detail, '2 files rebuilt', 'the detail belongs to the stage that ran');
    assert.equal(validating?.completedAt, null);
    assert.ok(seen.startedAt, 'the job records when work actually began');
  });

  it('refuses a second edit while one is running, which is what a double-click is', async () => {
    const first = await newJob();
    await advanceStage(first.id, 'rebuilding');

    const active = await activeJobFor(projectId);
    assert.equal(active?.id, first.id, 'the running job is discoverable before another starts');

    await finishJob(first.id, { status: 'SUCCEEDED', result: result('applied'), runId: 'run-1' });
    assert.equal(
      await activeJobFor(projectId),
      null,
      'once it is over, the next edit is allowed to start',
    );
  });

  it('keeps a refused edit distinct from a broken one', async () => {
    const rejected = await newJob();
    await finishJob(rejected.id, { status: 'REJECTED', result: result('rejected') });
    const seenRejected = await getJob(rejected.id, OWNER);
    assert.equal(seenRejected?.status, 'REJECTED');
    assert.equal(seenRejected.result?.rolledBack, true, 'the project kept its previous files');
    assert.equal(seenRejected.error, null, 'a refusal is not an error');

    await prisma.editJob.deleteMany({ where: { projectId } });
    const failed = await newJob();
    await finishJob(failed.id, { status: 'FAILED', error: 'the provider was unreachable' });
    const seenFailed = await getJob(failed.id, OWNER);
    assert.equal(seenFailed?.status, 'FAILED');
    assert.equal(seenFailed.result, null, 'a broken attempt produced no result to show');
    assert.match(seenFailed.error ?? '', /unreachable/);
  });

  it('is readable after a reload without the client remembering anything', async () => {
    const job = await newJob();
    await advanceStage(job.id, 'validating');

    // What a reloaded page asks: "what is this project doing?"
    const found = await latestJobFor(projectId, OWNER);
    assert.equal(found?.id, job.id);
    assert.equal(found.instruction, 'make the hero warmer', 'it can say what is being applied');
    assert.equal(isTerminal(found.status), false);
  });

  it('reports a job the process died under as interrupted, not as either outcome', async () => {
    const job = await newJob();
    await advanceStage(job.id, 'validating');

    const count = await reconcileInterruptedJobs();
    assert.ok(count >= 1);

    const seen = await getJob(job.id, OWNER);
    assert.equal(seen?.status, 'INTERRUPTED');
    assert.match(seen.error ?? '', /server restarted/);
    assert.match(seen.error ?? '', /was not applied/, 'it says what the project now contains');
    assert.equal(seen.result, null, 'nothing is claimed about what it produced');

    // Idempotent: a second boot finds nothing left to settle.
    const before = await getJob(job.id, OWNER);
    await reconcileInterruptedJobs();
    assert.deepEqual(await getJob(job.id, OWNER), before);
  });

  it('leaves finished jobs alone when a restart sweeps', async () => {
    const job = await newJob();
    await finishJob(job.id, { status: 'SUCCEEDED', result: result('applied'), runId: 'run-1' });
    await reconcileInterruptedJobs();
    assert.equal((await getJob(job.id, OWNER))?.status, 'SUCCEEDED');
  });

  it('does not hand one user another user’s edit', async () => {
    const job = await newJob();
    assert.equal(await getJob(job.id, INTRUDER), null, 'not yours reads exactly like not found');
    assert.equal(await latestJobFor(projectId, INTRUDER), null);
  });
});
