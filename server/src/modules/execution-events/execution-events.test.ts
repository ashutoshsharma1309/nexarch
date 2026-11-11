/**
 * The promises execution history makes: per-job order, failures that stay
 * out of the build, no secrets in the record, and streams that resume without
 * gaps, repeat nothing, answer only their owner and clean up after themselves.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';

import express from 'express';

import { errorHandler } from '../../shared/middleware/error-handler.js';
import { AppError } from '../../shared/utils/app-error.js';
import { closeExecutionStreams, createExecutionHandlers } from './execution-events.controller.js';
import {
  executionListenerCount,
  jobBelongsToProject,
  listExecutionEvents,
  listExecutionJobs,
  listStageUsage,
  publishExecutionEvent,
  interruptOrphanedJobs,
  recordStageUsage,
  subscribeToExecutionEvents,
  useExecutionStore,
} from './execution-events.service.js';
import { describeAll, selectArtifact } from '../pipeline/lib/artifact-index.js';
import type { PipelineArtifacts } from '../pipeline/pipeline.types.js';
import { createMemoryStore } from './lib/event-store.js';
import type { ExecutionStore, JobRecord } from './lib/event-store.js';
import type { ExecutionEvent, PublishExecutionEventInput } from './execution-events.types.js';

const PROJECT = 'project_a';
const JOB = 'job_1';

function input(
  message: string,
  extra: Partial<PublishExecutionEventInput> = {},
): PublishExecutionEventInput {
  return { projectId: PROJECT, jobKind: 'RUN', jobId: JOB, type: 'note', message, ...extra };
}

/** A memory store whose writes can be slowed, broken, and given job rows. */
function testStore(records: JobRecord[] = []): ExecutionStore & { failing: boolean } {
  const inner = createMemoryStore();
  return {
    ...inner,
    failing: false,
    jobRecords: (projectId, limit) =>
      Promise.resolve(records.slice(0, limit).filter(() => projectId === PROJECT)),
    jobRecord: (projectId, jobId) =>
      Promise.resolve(
        projectId === PROJECT ? (records.find((row) => row.jobId === jobId) ?? null) : null,
      ),
    async append(event) {
      if (this.failing) throw new Error('database is down');
      // Later publishes finish first unless the service really serialises.
      await new Promise((resolve) => setTimeout(resolve, event.message === 'slow' ? 20 : 0));
      return inner.append(event);
    },
    recordUsage(usage) {
      return this.failing
        ? Promise.reject(new Error('database is down'))
        : inner.recordUsage(usage);
    },
  };
}

let store: ReturnType<typeof testStore>;

beforeEach(() => {
  store = testStore();
  useExecutionStore(store);
});
afterEach(() => {
  useExecutionStore(createMemoryStore());
});

describe('interruptOrphanedJobs', () => {
  it('ends only a started job with no owner row and no terminal event', async () => {
    const started = (jobId: string) => ({
      projectId: PROJECT,
      jobKind: 'RUN' as const,
      jobId,
      type: 'job.started' as const,
      message: 'started',
    });
    await publishExecutionEvent(started('mesh-orphan'));
    await publishExecutionEvent(started('mesh-finished'));
    await publishExecutionEvent({
      ...started('mesh-finished'),
      type: 'job.completed',
      message: 'done',
    });

    assert.equal(await interruptOrphanedJobs(), 1);
    assert.equal(await interruptOrphanedJobs(), 0, 'a second sweep finds it settled');
    const events = await listExecutionEvents('mesh-orphan');
    assert.equal(events.at(-1)?.type, 'job.interrupted');
    assert.equal((await listExecutionEvents('mesh-finished')).at(-1)?.type, 'job.completed');
  });
});

describe('publishExecutionEvent', () => {
  it('assigns increasing seqs in publish order, even when an early write is slow', async () => {
    const results = await Promise.all([
      publishExecutionEvent(input('slow')),
      publishExecutionEvent(input('second')),
      publishExecutionEvent(input('third')),
    ]);
    assert.deepEqual(
      results.map((event) => event?.seq),
      [1, 2, 3],
    );
    assert.deepEqual(
      (await listExecutionEvents(JOB)).map((event) => event.message),
      ['slow', 'second', 'third'],
    );
  });

  it('keeps seq independent per job', async () => {
    await publishExecutionEvent(input('a'));
    const other = await publishExecutionEvent(input('b', { jobId: 'job_2' }));
    assert.equal(other?.seq, 1);
  });

  it('resolves null rather than throwing when the store fails', async () => {
    store.failing = true;
    assert.equal(await publishExecutionEvent(input('lost')), null);
    store.failing = false;
    assert.equal((await publishExecutionEvent(input('kept')))?.seq, 1);
  });

  it('resolves null for data that cannot be serialized', async () => {
    assert.equal(await publishExecutionEvent(input('big', { data: { n: BigInt(1) } })), null);
  });

  it('redacts secrets by value and by key before anything is stored', async () => {
    const key = `sk_${'a'.repeat(40)}`;
    const event = await publishExecutionEvent(
      input(`call failed with ${key}`, { data: { apiKey: 'plain', detail: `Bearer ${key}` } }),
    );
    assert.ok(event);
    assert.equal(event.message.includes(key), false);
    assert.equal(JSON.stringify(event.data).includes(key), false);
    assert.equal(event.data?.apiKey, '***');
  });

  it('replaces an oversized payload instead of storing half of it', async () => {
    const event = await publishExecutionEvent(input('big', { data: { text: 'x'.repeat(40_000) } }));
    assert.equal(event?.data?.omitted, 'payload too large');
  });

  it('survives a subscriber that throws and stops notifying after unsubscribe', async () => {
    const seen: number[] = [];
    const stopBad = subscribeToExecutionEvents(JOB, () => {
      throw new Error('bad listener');
    });
    const stop = subscribeToExecutionEvents(JOB, (event) => seen.push(event.seq));
    await publishExecutionEvent(input('one'));
    stop();
    stopBad();
    await publishExecutionEvent(input('two'));
    assert.deepEqual(seen, [1]);
    assert.equal(executionListenerCount(JOB), 0);
  });
});

describe('reads and usage', () => {
  it('returns only events after the cursor', async () => {
    for (const message of ['a', 'b', 'c']) await publishExecutionEvent(input(message));
    assert.deepEqual(
      (await listExecutionEvents(JOB, 2)).map((event) => event.seq),
      [3],
    );
  });

  it('keeps unknown token counts null rather than zero', async () => {
    const row = await recordStageUsage({
      projectId: PROJECT,
      jobId: JOB,
      stage: 'research',
      durationMs: 12.6,
    });
    assert.ok(row);
    assert.equal(row.inputTokens, null);
    assert.equal(row.costUsd, null);
    assert.equal(row.durationMs, 13);
    assert.equal((await listStageUsage(JOB)).length, 1);
  });

  it('resolves null when usage cannot be recorded', async () => {
    store.failing = true;
    assert.equal(
      await recordStageUsage({ projectId: PROJECT, jobId: JOB, stage: 's', durationMs: 1 }),
      null,
    );
  });

  it('lists jobs from their tables with event counts, including jobs with no history', async () => {
    useExecutionStore(
      (store = testStore([
        {
          jobId: 'old',
          jobKind: 'RUN',
          status: 'succeeded',
          title: 'old',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        {
          jobId: JOB,
          jobKind: 'RUN',
          status: 'running',
          title: 'new',
          createdAt: '2026-02-01T00:00:00.000Z',
        },
      ])),
    );
    await publishExecutionEvent(input('a'));
    const jobs = await listExecutionJobs(PROJECT);
    assert.deepEqual(
      jobs.map((job) => [job.jobId, job.eventCount]),
      [
        [JOB, 1],
        ['old', 0],
      ],
    );
    assert.equal(jobs[1]?.lastEventAt, null);
  });

  it("counts a job as the project's only when its table or events say so", async () => {
    await publishExecutionEvent(input('a'));
    assert.equal(await jobBelongsToProject(PROJECT, JOB), true);
    assert.equal(await jobBelongsToProject('other', JOB), false);
    assert.equal(await jobBelongsToProject(PROJECT, 'nope'), false);
  });
});

describe('research artifact in the artifact index', () => {
  const bundle = {
    runId: 'r1',
    requirements: { projectType: 'cafe', modules: [], database: [] },
    architecture: { apiModules: [], frontend: { pages: [] } },
    architectureMarkdown: '# A',
    design: {
      databaseDesign: { tables: [] },
      integrity: { stats: { tables: 0, relationships: 0 } },
      openapi: { paths: {} },
    },
    backend: { files: [], routes: [], modules: [] },
    frontend: { files: [], pages: [] },
    security: { report: { grade: 'A', overallScore: 90, findings: [] } },
    dependencies: { stats: { totalNodes: 0, totalEdges: 0 } },
    files: [],
  } as unknown as PipelineArtifacts;

  it('is not listed for a run with no research, and does not break the manifest', () => {
    const types = describeAll(bundle, PROJECT, '2026-01-01').map((entry) => entry.type);
    assert.equal(types.includes('research-artifact'), false);
    assert.equal(selectArtifact(bundle, 'research-artifact'), null);
  });

  it('is listed and selectable when the run has research', () => {
    const research = { status: 'partial', sources: [], findings: [] };
    const withResearch = { ...bundle, research } as unknown as PipelineArtifacts;
    const entry = describeAll(withResearch, PROJECT, '2026-01-01').find(
      (item) => item.type === 'research-artifact',
    );
    assert.match(entry?.summary ?? '', /^partial/);
    assert.equal(selectArtifact(withResearch, 'research-artifact'), research);
  });
});

describe('HTTP', () => {
  let server: http.Server;
  let base = '';
  // Lets a test hold authorization open while the client disconnects.
  let ownershipGate: Promise<void> = Promise.resolve();

  before(async () => {
    const app = express();
    app.use((req, _res, next) => {
      req.user = { id: req.headers['x-user'] === 'stranger' ? 'stranger' : 'owner' } as NonNullable<
        typeof req.user
      >;
      next();
    });
    const handlers = createExecutionHandlers({
      assertOwned: async (owner, projectId) => {
        await ownershipGate;
        if (owner !== 'owner' || projectId !== PROJECT)
          throw AppError.notFound('Project not found');
      },
      loadResearch: () => Promise.resolve(null),
      heartbeatMs: 20,
      settleGraceMs: 0,
    });
    app.get('/p/:projectId/executions', handlers.jobs);
    app.get('/p/:projectId/executions/:jobId/events', handlers.events);
    app.get('/p/:projectId/executions/:jobId/stream', handlers.stream);
    app.get('/p/:projectId/executions/:jobId/usage', handlers.usage);
    app.get('/p/:projectId/runs/:runId/research', handlers.research);
    app.use(errorHandler);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });

  after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  const body = async (response: Response): Promise<{ data: unknown }> =>
    (await response.json()) as { data: unknown };

  /** Reads an SSE response until `done` says stop or the server ends it. */
  async function readStream(
    path: string,
    headers: Record<string, string>,
    done: (text: string) => boolean = () => false,
  ): Promise<string> {
    const controller = new AbortController();
    const response = await fetch(`${base}${path}`, { headers, signal: controller.signal });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/);
    assert.match(response.headers.get('cache-control') ?? '', /no-transform/);
    assert.ok(response.body);
    const reader = response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
    const decoder = new TextDecoder();
    let text = '';
    for (;;) {
      const { value, done: ended } = await reader.read();
      if (ended) break;
      text += decoder.decode(value, { stream: true });
      if (done(text)) {
        controller.abort();
        break;
      }
    }
    return text;
  }

  const ids = (text: string): number[] =>
    [...text.matchAll(/^id: (\d+)$/gm)].map((match) => Number(match[1]));

  const waitFor = async (check: () => boolean): Promise<void> => {
    for (let i = 0; i < 200 && !check(); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.ok(check());
  };

  it('refuses a project the caller does not own, on every route', async () => {
    await publishExecutionEvent(input('private'));
    for (const path of [
      '/executions',
      `/executions/${JOB}/events`,
      `/executions/${JOB}/stream`,
      `/executions/${JOB}/usage`,
      '/runs/r1/research',
    ]) {
      const response = await fetch(`${base}/p/${PROJECT}${path}`, {
        headers: { 'x-user': 'stranger' },
      });
      assert.equal(response.status, 404, path);
    }
  });

  it('answers 404 for a job outside the project', async () => {
    await publishExecutionEvent(input('elsewhere', { projectId: 'project_b' }));
    assert.equal((await fetch(`${base}/p/${PROJECT}/executions/${JOB}/events`)).status, 404);
    assert.equal((await fetch(`${base}/p/${PROJECT}/executions/${JOB}/stream`)).status, 404);
  });

  it('pages events by cursor and rejects a nonsense cursor', async () => {
    for (const message of ['a', 'b']) await publishExecutionEvent(input(message));
    const page = await fetch(`${base}/p/${PROJECT}/executions/${JOB}/events?after=1`);
    assert.deepEqual(
      ((await body(page)).data as ExecutionEvent[]).map((event) => event.seq),
      [2],
    );
    assert.equal(
      (await fetch(`${base}/p/${PROJECT}/executions/${JOB}/events?after=x`)).status,
      400,
    );
  });

  it('replays after Last-Event-ID, then delivers live events and ends on a terminal one', async () => {
    for (const message of ['a', 'b', 'c']) await publishExecutionEvent(input(message));
    const reading = readStream(`/p/${PROJECT}/executions/${JOB}/stream`, { 'Last-Event-ID': '1' });
    await waitFor(() => executionListenerCount(JOB) === 1);
    await publishExecutionEvent(input('live'));
    await publishExecutionEvent(input('done', { type: 'job.completed', status: 'succeeded' }));
    const text = await reading;
    assert.deepEqual(ids(text), [2, 3, 4, 5]);
    assert.match(text, /event: end\ndata: .*terminal-event/);
    await waitFor(() => executionListenerCount(JOB) === 0);
  });

  it('does not subscribe for a client that left during authorization', async () => {
    await publishExecutionEvent(input('a'));
    let release = (): void => undefined;
    ownershipGate = new Promise((resolve) => {
      release = resolve;
    });
    const controller = new AbortController();
    const leaving = fetch(`${base}/p/${PROJECT}/executions/${JOB}/stream`, {
      signal: controller.signal,
    }).catch(() => null);
    await new Promise((resolve) => setTimeout(resolve, 30));
    controller.abort();
    await leaving;
    await new Promise((resolve) => setTimeout(resolve, 30));
    release();
    ownershipGate = Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(executionListenerCount(JOB), 0);
  });

  it('ends open streams on shutdown without declaring the job over', async () => {
    await publishExecutionEvent(input('a'));
    const reading = readStream(`/p/${PROJECT}/executions/${JOB}/stream`, {});
    await waitFor(() => executionListenerCount(JOB) === 1);
    closeExecutionStreams();
    const text = await reading;
    assert.doesNotMatch(text, /event: end/);
    await waitFor(() => executionListenerCount(JOB) === 0);
  });

  it('sends heartbeats and releases its listener when the client leaves', async () => {
    await publishExecutionEvent(input('a'));
    const text = await readStream(`/p/${PROJECT}/executions/${JOB}/stream`, {}, (received) =>
      received.includes(': heartbeat'),
    );
    assert.deepEqual(ids(text), [1]);
    await waitFor(() => executionListenerCount(JOB) === 0);
  });

  it('closes the stream of a settled job that never published a terminal event', async () => {
    useExecutionStore(
      (store = testStore([
        {
          jobId: JOB,
          jobKind: 'RUN',
          status: 'failed',
          title: 'old',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ])),
    );
    const text = await readStream(`/p/${PROJECT}/executions/${JOB}/stream`, {});
    assert.match(text, /event: end\ndata: .*job-settled/);
  });
});
