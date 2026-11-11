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
  pruneTerminalEditJobs,
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
    // It must NOT claim the edit was not applied. This assertion used to
    // require that claim, and the claim is false: `applyEdit` persists the
    // edited run before `finishJob` is reached, so a restart late in an
    // apply may well have landed the changes. The honest message says the
    // outcome is unknown and tells the user to look.
    assert.doesNotMatch(seen.error ?? '', /was not applied|still has the files/);
    assert.match(seen.error ?? '', /not known how far it got/);
    assert.match(seen.error ?? '', /check the project/);
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

/**
 * Retention for finished edit jobs.
 *
 * The table had no retention at all: every apply ever made left a permanent
 * row carrying an instruction, a stages array and a stored diff. These tests
 * exist mostly to pin down what the sweep must NEVER do, because the cost of
 * the two failure modes is not symmetric — keeping a row too long wastes a
 * few kilobytes, while deleting the wrong one destroys a user's edit history
 * or, worse, the row a live edit is relying on.
 *
 * The window is crossed by moving the clock forward rather than by writing
 * rows with backdated timestamps: `pruneTerminalEditJobs` takes `now`, so a
 * test can ask "what would this sweep do in forty days" deterministically.
 */
describe('finished edit job retention', () => {
  const DAY_MS = 24 * 60 * 60_000;
  /** Comfortably past the default thirty-day window. */
  const wellPastWindow = (): Date => new Date(Date.now() + 40 * DAY_MS);

  let otherProjectId = '';

  before(async () => {
    const project = await prisma.project.create({
      data: {
        ownerId: OWNER,
        name: 'Edit Job Retention',
        slug: 'edit-job-retention',
        status: 'ACTIVE',
      },
    });
    otherProjectId = project.id;
  });

  beforeEach(async () => {
    await prisma.editJob.deleteMany({ where: { projectId: { in: [projectId, otherProjectId] } } });
  });

  /**
   * A finished row, written directly.
   *
   * `createJob` cannot express a completed job in the past, and the point
   * here is the sweep's predicate rather than the lifecycle that produced
   * the row.
   */
  async function finished(
    project: string,
    status: 'SUCCEEDED' | 'REJECTED' | 'FAILED' | 'INTERRUPTED',
    completedAt: Date,
  ): Promise<string> {
    const row = await prisma.editJob.create({
      data: {
        projectId: project,
        ownerId: OWNER,
        planId: 'plan-retention',
        instruction: 'make the hero warmer',
        status,
        stage: 'finished',
        stages: [],
        completedAt,
      },
    });
    return row.id;
  }

  const idsFor = async (project: string): Promise<string[]> =>
    (await prisma.editJob.findMany({ where: { projectId: project }, select: { id: true } })).map(
      (row) => row.id,
    );

  it('never deletes an active job, however long it has been sitting there', async () => {
    // The case that matters most: a QUEUED or RUNNING row is the only thing
    // standing between a second apply and two edits racing over one
    // baseline, and the partial unique index is enforced on exactly these
    // two statuses. A retention sweep that took one would hand the project
    // to a duplicate edit.
    const queued = await createJob({
      projectId: otherProjectId,
      ownerId: OWNER,
      planId: 'plan-active',
      instruction: 'this edit is still running',
    });
    await advanceStage(queued.id, 'rebuilding');
    const running = await getJob(queued.id, OWNER);
    assert.equal(running?.status, 'RUNNING', 'precondition: the job is active');

    // A clock a year in the future, so no window could possibly spare it.
    const result = await pruneTerminalEditJobs(new Date(Date.now() + 365 * DAY_MS));

    assert.equal(result.error, null);
    const survivor = await getJob(queued.id, OWNER);
    assert.equal(survivor?.status, 'RUNNING', 'the active job is still there, still RUNNING');
    assert.ok(
      await activeJobFor(otherProjectId),
      'and it still blocks a second edit for this project',
    );
  });

  it('deletes finished jobs past the window but keeps the newest one', async () => {
    const oldest = await finished(otherProjectId, 'SUCCEEDED', new Date(Date.now() - 3 * DAY_MS));
    const middle = await finished(otherProjectId, 'FAILED', new Date(Date.now() - 2 * DAY_MS));
    const newest = await finished(otherProjectId, 'REJECTED', new Date(Date.now() - 1 * DAY_MS));

    const result = await pruneTerminalEditJobs(wellPastWindow());

    assert.equal(result.error, null);
    assert.equal(result.removed, 2, 'the two older rows went');
    const left = await idsFor(otherProjectId);
    assert.deepEqual(left, [newest], 'the newest finished job is kept as project history');
    assert.ok(!left.includes(oldest));
    assert.ok(!left.includes(middle));
  });

  it('keeps a project its last edit even when that edit is ancient', async () => {
    // A project edited once, a year ago, must not end up with no history at
    // all just because its only row is older than the window.
    const only = await finished(otherProjectId, 'SUCCEEDED', new Date(Date.now() - 400 * DAY_MS));

    const result = await pruneTerminalEditJobs(wellPastWindow());

    assert.equal(result.removed, 0);
    assert.deepEqual(await idsFor(otherProjectId), [only]);
  });

  it('leaves finished jobs that are still inside the window', async () => {
    await finished(otherProjectId, 'SUCCEEDED', new Date(Date.now() - 3 * DAY_MS));
    await finished(otherProjectId, 'FAILED', new Date(Date.now() - 2 * DAY_MS));

    // "Now" is now: nothing is past a thirty-day window yet.
    const result = await pruneTerminalEditJobs(new Date());

    assert.equal(result.removed, 0);
    assert.equal((await idsFor(otherProjectId)).length, 2);
  });

  it('is safe to run twice — the second sweep finds nothing left to do', async () => {
    await finished(otherProjectId, 'SUCCEEDED', new Date(Date.now() - 3 * DAY_MS));
    await finished(otherProjectId, 'FAILED', new Date(Date.now() - 2 * DAY_MS));
    await finished(otherProjectId, 'REJECTED', new Date(Date.now() - 1 * DAY_MS));

    const first = await pruneTerminalEditJobs(wellPastWindow());
    const second = await pruneTerminalEditJobs(wellPastWindow());

    assert.equal(first.removed, 2);
    assert.equal(second.removed, 0, 'idempotent: deletes are by primary key');
    assert.equal(second.error, null);
    assert.equal(second.more, false);
  });

  it('prunes each project independently', async () => {
    const keptA = await finished(projectId, 'SUCCEEDED', new Date(Date.now() - 1 * DAY_MS));
    const goneA = await finished(projectId, 'FAILED', new Date(Date.now() - 9 * DAY_MS));
    const keptB = await finished(otherProjectId, 'SUCCEEDED', new Date(Date.now() - 1 * DAY_MS));
    const goneB = await finished(otherProjectId, 'FAILED', new Date(Date.now() - 9 * DAY_MS));

    await pruneTerminalEditJobs(wellPastWindow());

    assert.deepEqual(await idsFor(projectId), [keptA], 'one project keeps its newest');
    assert.deepEqual(await idsFor(otherProjectId), [keptB], 'so does the other');
    for (const gone of [goneA, goneB]) {
      assert.equal(await prisma.editJob.findUnique({ where: { id: gone } }), null);
    }
  });

  it('does not stall behind the rows it must keep', async () => {
    // The failure this guards: each project's newest finished edit can never
    // be deleted, and those rows live at the oldest end of the table. Once
    // enough projects have one, an oldest-first window is made entirely of
    // them, and the sweep deleted nothing for ever while reporting there was
    // nothing to do — retention silently stopped working.
    //
    // Reproduced with a batch of 2 rather than 500: three projects whose
    // only (ancient) edit must be kept, in front of a project with
    // deletable history behind them.
    const keepers: string[] = [];
    const extraProjects: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const project = await prisma.project.create({
        data: {
          ownerId: OWNER,
          name: `Retention Wall ${String(i)}`,
          slug: `retention-wall-${String(i)}`,
          status: 'ACTIVE',
        },
      });
      extraProjects.push(project.id);
      // Oldest of all, so they fill the first windows.
      keepers.push(
        await finished(project.id, 'SUCCEEDED', new Date(Date.now() - (500 - i) * DAY_MS)),
      );
    }
    // Behind the wall: a project with one keeper and two deletable rows.
    const doomedA = await finished(otherProjectId, 'FAILED', new Date(Date.now() - 9 * DAY_MS));
    const doomedB = await finished(otherProjectId, 'FAILED', new Date(Date.now() - 8 * DAY_MS));
    const keptNewest = await finished(
      otherProjectId,
      'SUCCEEDED',
      new Date(Date.now() - 1 * DAY_MS),
    );

    // The guarantee is progress, not that one sweep clears everything: each
    // sweep walks past the keepers and deletes what it reaches, and because
    // the window overlaps by one row a small batch may delete one at a time.
    // Repeated sweeps are how a backlog drains, which is what boot does.
    let removedTotal = 0;
    for (let sweep = 0; sweep < 10; sweep += 1) {
      const pass = await pruneTerminalEditJobs(wellPastWindow(), 2);
      assert.equal(pass.error, null);
      if (pass.removed === 0) break;
      removedTotal += pass.removed;
    }

    assert.equal(removedTotal, 2, 'it got past the wall rather than deleting nothing for ever');
    for (const id of keepers) {
      assert.ok(
        await prisma.editJob.findUnique({ where: { id } }),
        'every project keeps its only edit',
      );
    }
    assert.equal(await prisma.editJob.findUnique({ where: { id: doomedA } }), null);
    assert.equal(await prisma.editJob.findUnique({ where: { id: doomedB } }), null);
    assert.ok(await prisma.editJob.findUnique({ where: { id: keptNewest } }));

    await prisma.editJob.deleteMany({ where: { projectId: { in: extraProjects } } });
    await prisma.project.deleteMany({ where: { id: { in: extraProjects } } });
  });

  it('deletes edit jobs and nothing else', async () => {
    await finished(otherProjectId, 'SUCCEEDED', new Date(Date.now() - 9 * DAY_MS));
    await finished(otherProjectId, 'FAILED', new Date(Date.now() - 8 * DAY_MS));
    const projectsBefore = await prisma.project.count();
    const artifactsBefore = await prisma.runArtifact.count();
    const nodesBefore = await prisma.graphNode.count();

    await pruneTerminalEditJobs(wellPastWindow());

    // Retention is for the job table. A project, its generated output and
    // its graph are not maintenance.
    assert.equal(await prisma.project.count(), projectsBefore);
    assert.equal(await prisma.runArtifact.count(), artifactsBefore);
    assert.equal(await prisma.graphNode.count(), nodesBefore);
  });

  after(async () => {
    await prisma.editJob.deleteMany({ where: { projectId: otherProjectId } });
    await prisma.project.deleteMany({ where: { id: otherProjectId } });
  });
});
