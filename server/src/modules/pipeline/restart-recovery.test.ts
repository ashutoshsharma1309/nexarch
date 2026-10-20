/**
 * What happens to a run when the API process dies underneath it.
 *
 * The bug these tests pin: a run's progress and its generated files live in
 * the API process, but the row saying the run exists lives in the database.
 * Kill the process mid-build and the row keeps claiming to be working, so the
 * project shows "building" forever with nothing building — and the only way
 * out was to notice and rebuild.
 *
 * The rule under test is deliberately narrow. At boot, nothing has started
 * executing in this process yet, so every row still claiming to work belongs
 * to a process that is gone; that is what makes settling them safe rather
 * than a guess about someone else's live work.
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

// The store decides between Postgres and its in-memory twin from the config
// it reads at import time. Clearing DATABASE_URL first pins this file to the
// no-DB branch, so the suite can never reach — or rewrite — the development
// database. The Postgres branch is exercised at boot and verified against the
// running application instead.
// `dotenv/config` would read the developer's .env back in and hand the store
// a real database, so it is pointed at a path that does not exist first.
process.env.DOTENV_CONFIG_PATH = '/nonexistent/.env';
delete process.env.DATABASE_URL;
const {
  closeRun,
  listRunsForProject,
  memGenerationsForProject,
  openRun,
  reconcileInterruptedRuns,
  resetRunStoreForTests,
  seedRunForTests,
} = await import('./lib/run-store.js');

const PROJECT = 'project-restart';

/** Every stage a run can be interrupted in, as the status column spells it. */
const WORKING_STATUSES = ['PENDING', 'ANALYZING', 'PLANNING', 'GENERATING', 'REVIEWING'] as const;

describe('restart recovery', () => {
  beforeEach(() => {
    resetRunStoreForTests();
  });

  it('settles a run interrupted in any stage, and says why', async () => {
    for (const [index, status] of WORKING_STATUSES.entries()) {
      seedRunForTests({ id: `run-${String(index)}`, projectId: PROJECT, status });
    }

    const result = await reconcileInterruptedRuns();
    assert.equal(result.reconciled, WORKING_STATUSES.length);
    assert.equal(result.error, null);

    const runs = memGenerationsForProject(PROJECT);
    assert.equal(runs.length, WORKING_STATUSES.length);
    for (const run of runs) {
      assert.equal(run.status, 'FAILED', 'a run whose process is gone is not still running');
      assert.match(run.error ?? '', /interrupted by a server restart/);
      assert.match(run.error ?? '', /rebuild the project/, 'the reason must say what to do next');
      assert.notEqual(run.completedAt, null);
    }
  });

  it('leaves runs that genuinely finished alone', async () => {
    await openRun('done', PROJECT, 'a build that finished');
    await closeRun('done', 'COMPLETED');
    await openRun('broke', PROJECT, 'a build that failed on its own');
    await closeRun('broke', 'FAILED', 'the generator threw');

    const result = await reconcileInterruptedRuns();
    assert.equal(result.reconciled, 0);

    const byId = new Map(memGenerationsForProject(PROJECT).map((run) => [run.id, run]));
    assert.equal(byId.get('done')?.status, 'COMPLETED');
    assert.equal(byId.get('broke')?.status, 'FAILED');
    assert.equal(
      byId.get('broke')?.error,
      'the generator threw',
      'a real failure keeps its own reason',
    );
  });

  it('is idempotent — a second sweep changes nothing', async () => {
    await openRun('interrupted', PROJECT, 'build');
    const first = await reconcileInterruptedRuns();
    const after = memGenerationsForProject(PROJECT)[0];
    assert.equal(first.reconciled, 1);

    const second = await reconcileInterruptedRuns();
    assert.equal(second.reconciled, 0, 'nothing is left to settle');
    assert.deepEqual(memGenerationsForProject(PROJECT)[0], after, 'and nothing was rewritten');
  });

  it('reports nothing to do when there is no persisted state at all', async () => {
    const result = await reconcileInterruptedRuns();
    assert.deepEqual(result, { reconciled: 0, error: null });
    assert.deepEqual(await listRunsForProject(PROJECT), []);
  });

  it('settles only runs that were working, across several projects', async () => {
    await openRun('a', 'project-one', 'build one');
    await openRun('b', 'project-two', 'build two');
    await closeRun('b', 'COMPLETED');

    const result = await reconcileInterruptedRuns();
    assert.equal(result.reconciled, 1, 'the finished run in the other project is untouched');
    assert.equal(memGenerationsForProject('project-two')[0]?.status, 'COMPLETED');
    assert.equal(memGenerationsForProject('project-one')[0]?.status, 'FAILED');
  });
});
