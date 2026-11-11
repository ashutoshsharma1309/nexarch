/**
 * Logger tests (`npm test`).
 *
 * Four claims are worth a test here, because each fails silently: that a
 * correlation id reaches work a request started and left running, that the
 * id in the logs is the id the response envelope hands the client, that no
 * log line can carry a credential, and that no log line can carry a whole
 * prompt or generated file. The assertions run against
 * what the transports actually receive — the formatted line — not against
 * the redactor in isolation, because the format chain is where an ordering
 * mistake would reintroduce the raw text.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Writable } from 'node:stream';

import winston from 'winston';
import type { Request, Response } from 'express';

import { logger } from './index.js';
import { logEvent, startTimer } from './events.js';
import { clearTimelines, getTimeline, listTimelines, summarize } from './timeline.js';
import {
  currentLogContext,
  currentRequestId,
  runWithLogContext,
  setLogContext,
  withLogContext,
} from './context.js';
import { requestContext } from '../middleware/request-context.js';

/**
 * Runs `emit` with the logger's transports swapped for an in-memory sink and
 * returns everything written. The real transports are detached for the
 * duration so the suite does not print the secrets it is testing with, and
 * `silent`/`level` are forced because the test environment ships the logger
 * muted.
 */
async function capture(emit: () => void | Promise<void>): Promise<string> {
  const chunks: string[] = [];
  const sink = new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      chunks.push(String(chunk));
      callback();
    },
  });
  const previous = [...logger.transports];
  const wasSilent = logger.silent;
  const wasLevel = logger.level;
  logger.clear();
  logger.add(new winston.transports.Stream({ stream: sink }));
  logger.silent = false;
  logger.level = 'debug';
  try {
    await emit();
    // Winston hands a record to its transports on a later tick.
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
  } finally {
    logger.clear();
    for (const transport of previous) logger.add(transport);
    logger.silent = wasSilent;
    logger.level = wasLevel;
  }
  return chunks.join('');
}

/* ── Correlation ──────────────────────────────────────────────────────── */

describe('log correlation', () => {
  it('reaches work the request detaches and leaves running', async () => {
    const output = await capture(async () => {
      // What `startRun` does: launch, return, and keep logging afterwards.
      const detached = runWithLogContext({ requestId: 'req-outlives-response' }, () =>
        (async () => {
          await new Promise((resolve) => {
            setTimeout(resolve, 5);
          });
          logger.info('stage finished long after the response went out');
        })(),
      );
      await detached;
    });

    assert.ok(output.includes('req-outlives-response'));
  });

  it('never overwrites a field the call site set itself', async () => {
    const output = await capture(() => {
      runWithLogContext({ requestId: 'ambient-id' }, () => {
        logger.info('replaying an older request', { requestId: 'explicit-id' });
      });
    });

    assert.ok(output.includes('explicit-id'));
    assert.ok(!output.includes('ambient-id'));
  });

  it('fills an explicit null, which is how audit events arrive', async () => {
    const output = await capture(() => {
      runWithLogContext({ requestId: 'audited-request', userId: 'u-42' }, () => {
        // The shape `audit()` builds: every id present, most of them null.
        logger.info('audit UNAUTHORIZED_ACCESS_ATTEMPT', {
          audit: true,
          requestId: null,
          userId: null,
          runId: null,
        });
      });
    });

    assert.ok(output.includes('audited-request'));
    assert.ok(output.includes('u-42'));
  });

  it('adds ids mid-request without leaking a forked id to its siblings', () => {
    runWithLogContext({ requestId: 'r1' }, () => {
      setLogContext({ userId: 'u1' });
      withLogContext({ runId: 'run-a' }, () => {
        assert.equal(currentLogContext()?.runId, 'run-a');
        assert.equal(currentLogContext()?.userId, 'u1');
      });
      assert.equal(currentLogContext()?.runId, undefined);
      assert.equal(currentRequestId(), 'r1');
    });
  });

  it('logs without a context rather than throwing outside a request', async () => {
    setLogContext({ runId: 'ignored' });
    const output = await capture(() => {
      logger.info('boot sequence');
    });

    assert.ok(output.includes('boot sequence'));
    assert.ok(!output.includes('ignored'));
    assert.equal(currentLogContext(), undefined);
  });
});

describe('request correlation middleware', () => {
  it('seeds the context with the id the response header and envelope carry', async () => {
    const headers = new Map<string, string>();
    const req = { get: (): string | undefined => undefined } as unknown as Request;
    const res = {
      setHeader(name: string, value: string): void {
        headers.set(name, value);
      },
    } as unknown as Response;

    let detached: Promise<void> = Promise.resolve();
    const output = await capture(async () => {
      requestContext(req, res, () => {
        // The shape of a handler that answers now and keeps working after.
        detached = (async () => {
          await new Promise((resolve) => {
            setTimeout(resolve, 5);
          });
          logger.info('work the request left running');
        })();
      });
      await detached;
    });

    const assigned = headers.get('X-Request-Id');
    assert.ok(assigned !== undefined);
    // `req.id` is what `sendSuccess` and the error envelope report as
    // `meta.requestId`, so this is the assertion that the id a client is
    // told to quote is the id in the logs.
    assert.equal(req.id, assigned);
    assert.ok(output.includes(assigned));
  });
});

/* ── Redaction ────────────────────────────────────────────────────────── */

describe('log redaction', () => {
  it('keeps provider keys, credential URLs, bearers and JWTs out of the line', async () => {
    // Shaped like the real things, valid for nothing.
    const groqKey = 'gsk_8fQ2kLpZ0rTvWxYb3nJmAa1CdEfGhIjKlMnOpQrSt';
    const databaseUrl = 'postgresql://nexarch:Sup3rS3cretPassw0rd@db.internal:5432/nexarch';
    const bearer = 'Bearer 7xKqP0vZmT2sLbNd9RfAeHgJuYwCvBnMiOkPlQaZ';
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEyMyJ9.T4nQ8bVxZ2mLpKdRfAeHgJuYwCvBnMiOkPlQaZ';

    const output = await capture(() => {
      logger.error(`provider refused the key ${groqKey}`, {
        stage: 'backend-generation',
        // Keys that say nothing about their contents: this is the
        // value-shape rule, the one a caller cannot help with.
        detail: { connection: databaseUrl, header: bearer, identity: jwt },
        // And the key-name rule, nested where a caller would forget it.
        env: [{ apiKey: groqKey }, { password: 'hunter2hunter2' }],
      });
    });

    assert.ok(!output.includes('gsk_8fQ2kLpZ0rTvWxYb3nJmAa1CdEfGhIjKlMnOpQrSt'));
    assert.ok(!output.includes('Sup3rS3cretPassw0rd'));
    assert.ok(!output.includes('7xKqP0vZmT2sLbNd9RfAeHgJuYwCvBnMiOkPlQaZ'));
    assert.ok(!output.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'));
    assert.ok(!output.includes('hunter2hunter2'));
    assert.ok(output.includes('***'));
    // The diagnosable part of the line survives the scrubbing.
    assert.ok(output.includes('backend-generation'));
  });

  it('redacts a thrown error, whose message and stack are the usual leak', async () => {
    const output = await capture(() => {
      logger.error(new Error('groq call failed for key gsk_2pLmNbVcXzAsDfGhJkLqWeRtYuIoP'));
    });

    assert.ok(!output.includes('gsk_2pLmNbVcXzAsDfGhJkLqWeRtYuIoP'));
    assert.ok(output.includes('groq call failed'));
  });

  it('redacts an operational event, which gets no exemption', async () => {
    const output = await capture(() => {
      logEvent({
        event: 'process.exit',
        command: 'npm run dev',
        exitCode: 1,
        signal: null,
        durationMs: 2_400,
      });
      logEvent({
        event: 'stage.end',
        stage: 'runtime-validation',
        outcome: 'failed',
        durationMs: 90,
        reason: 'Error: P1001 — mysql://runner:Tr0ub4dor@localhost:3307/app unreachable',
      });
    });

    assert.ok(!output.includes('Tr0ub4dor'));
    assert.ok(output.includes('runtime-validation'));
  });
});

/* ── Payload ceiling ──────────────────────────────────────────────────── */

describe('log payload ceiling', () => {
  const generatedFile = 'export const Dashboard = (): JSX.Element => <main />;\n'.repeat(400);

  it('refuses to carry a whole generated file in a metadata field', async () => {
    const output = await capture(() => {
      logger.warn('stage failed', { stage: 'frontend-generation', reason: generatedFile });
    });

    assert.ok(generatedFile.length > 20_000);
    assert.ok(!output.includes(generatedFile));
    assert.ok(output.includes('chars]'));
    assert.ok(output.length < 4_000);
  });

  it('refuses to carry a whole prompt in the message', async () => {
    const output = await capture(() => {
      logger.info(`prompt sent: ${generatedFile}`);
    });

    assert.ok(!output.includes(generatedFile));
    assert.ok(output.length < 4_000);
  });
});

/* ── Operational events ───────────────────────────────────────────────── */

describe('operational events', () => {
  it('publishes a token count only when the provider reported one', async () => {
    const placeholder = await capture(() => {
      logEvent({
        event: 'model.call',
        provider: 'groq',
        model: 'llama-3.3-70b',
        outcome: 'failed',
        durationMs: 1_200,
        // What the orchestrator fills in for a call that never billed.
        tokens: { inputTokens: 0, outputTokens: 0 },
      });
    });
    assert.ok(!placeholder.includes('usage'));

    const reported = await capture(() => {
      logEvent({
        event: 'model.call',
        provider: 'groq',
        model: 'llama-3.3-70b',
        outcome: 'success',
        calls: 2,
        retries: 1,
        durationMs: 1_200,
        tokens: { inputTokens: 4_210, outputTokens: 918 },
      });
    });
    // `usage`, not `tokens`: the shared redactor masks any key containing
    // "token", which is what silently emptied these figures before.
    assert.ok(reported.includes('"usage":{"input":4210,"output":918}'));
    assert.ok(!reported.includes('***'));
  });

  it('files a failure at warn and a normal outcome at info', async () => {
    const failed = await capture(() => {
      logEvent({
        event: 'cleanup',
        target: 'workspace/run-7',
        outcome: 'failed',
        reason: 'EBUSY',
        durationMs: 11,
      });
    });
    assert.ok(failed.includes('warn'));

    const passed = await capture(() => {
      logEvent({
        event: 'validation',
        target: 'architecture.schema',
        outcome: 'passed',
        issues: 0,
      });
    });
    assert.ok(passed.includes('info'));
    assert.ok(passed.includes('architecture.schema'));
  });

  it('measures a duration that cannot come out negative', () => {
    const elapsed = startTimer()();
    assert.ok(elapsed >= 0);
  });
});

/**
 * The execution timeline.
 *
 * Two kinds of mistake are worth a test here. The first is grouping: an
 * event filed under the wrong correlation is worse than no event, because
 * it attributes one user's failure to another run. The second is the honesty
 * rule the summary exists to keep — a question nothing measured must come
 * back null, never zero, because a reader cannot tell a measured zero from
 * a placeholder and the placeholder is the one that misleads.
 */
describe('execution timeline', () => {
  const OWNER = 'user-timeline';

  /** Emits under a fresh context and returns the timeline it produced. */
  function underContext(
    context: { runId?: string; jobId?: string; sessionId?: string; requestId?: string },
    emit: () => void,
  ): ReturnType<typeof getTimeline> {
    clearTimelines();
    let key = '';
    runWithLogContext({ ...context, userId: OWNER }, () => {
      key = context.runId ?? context.jobId ?? context.sessionId ?? context.requestId ?? '';
      emit();
    });
    return getTimeline(key, OWNER);
  }

  it('groups events under the run, which is the unit a reader thinks in', () => {
    const timeline = underContext({ runId: 'run-1', requestId: 'req-1' }, () => {
      logEvent({ event: 'stage.start', stage: 'analysis' });
      logEvent({ event: 'stage.end', stage: 'analysis', outcome: 'completed', durationMs: 120 });
    });

    assert.equal(timeline?.key, 'run-1', 'the run id wins over the request id');
    assert.equal(timeline.entries.length, 2);
    assert.deepEqual(
      timeline.entries.map((entry) => entry.event.event),
      ['stage.start', 'stage.end'],
    );
  });

  it('groups an edit under its job, which has no run id while it runs', () => {
    const timeline = underContext({ jobId: 'job-9', requestId: 'req-2' }, () => {
      logEvent({ event: 'job.transition', jobId: 'job-9', from: 'QUEUED', to: 'RUNNING' });
    });
    assert.equal(timeline?.key, 'job-9');
  });

  it('keeps events the request detached and left running', async () => {
    clearTimelines();
    // The shape that matters: the caller returns, the work carries on, and
    // its events must still land under the run it belongs to.
    await new Promise<void>((resolve) => {
      runWithLogContext({ runId: 'run-detached', userId: OWNER }, () => {
        void (async () => {
          await new Promise((tick) => setTimeout(tick, 5));
          logEvent({ event: 'stage.start', stage: 'backend' });
          resolve();
        })();
      });
    });
    assert.equal(getTimeline('run-detached', OWNER)?.entries.length, 1);
  });

  it('answers the questions a post-mortem actually asks', () => {
    const timeline = underContext({ runId: 'run-2' }, () => {
      logEvent({ event: 'run.start', trigger: 'prompt', stages: 8 });
      logEvent({ event: 'stage.end', stage: 'analysis', outcome: 'completed', durationMs: 400 });
      logEvent({ event: 'stage.end', stage: 'backend', outcome: 'completed', durationMs: 9_000 });
      logEvent({ event: 'stage.end', stage: 'frontend', outcome: 'completed', durationMs: 1_200 });
      logEvent({ event: 'agent.start', agentId: 'backend-engineer' });
      logEvent({
        event: 'agent.end',
        agentId: 'backend-engineer',
        outcome: 'failed',
        durationMs: 300,
        reason: 'provider unreachable',
      });
      logEvent({ event: 'retry', target: 'backend-engineer', attempt: 1, reason: 'transient' });
      logEvent({ event: 'retry', target: 'backend-engineer', attempt: 2, reason: 'transient' });
      logEvent({
        event: 'model.call',
        provider: 'groq',
        model: 'openai/gpt-oss-20b',
        outcome: 'success',
        durationMs: 800,
        retries: 1,
        costUsd: 0.0002,
      });
      logEvent({
        event: 'model.call',
        provider: 'groq',
        model: 'openai/gpt-oss-20b',
        outcome: 'cached',
        durationMs: 2,
      });
      logEvent({
        event: 'validation',
        target: 'build',
        outcome: 'passed',
        issues: 0,
        durationMs: 5_000,
      });
      logEvent({
        event: 'validation',
        target: 'lint',
        outcome: 'failed',
        issues: 3,
        durationMs: 1_000,
      });
      logEvent({
        event: 'repair.attempt',
        attempt: 1,
        target: 'finding f1',
        outcome: 'fixed',
        durationMs: 700,
      });
      logEvent({
        event: 'rollback',
        target: 'project p1',
        outcome: 'restored',
        reason: 'validation failed',
      });
      logEvent({
        event: 'process.exit',
        command: 'npm',
        exitCode: 1,
        signal: null,
        durationMs: 60,
      });
      logEvent({
        event: 'run.end',
        outcome: 'failed',
        durationMs: 20_000,
        completed: 6,
        skipped: 1,
        failed: 1,
      });
    });

    const summary = timeline?.summary;
    assert.ok(summary);
    // Which stage took the longest?
    assert.deepEqual(summary.slowestStage, { stage: 'backend', durationMs: 9_000 });
    assert.equal(summary.totalStageMs, 10_600);
    // Which agent failed?
    assert.deepEqual(summary.failedAgents, ['backend-engineer']);
    // How many model calls, and how many were free?
    assert.equal(summary.modelCalls, 2);
    assert.equal(summary.cachedModelCalls, 1);
    // How many retries were needed?
    assert.equal(summary.retries, 2);
    assert.equal(summary.modelRetries, 1);
    // How long did validation take, and what failed?
    assert.equal(summary.validationMs, 6_000);
    assert.equal(summary.validationsPassed, 1);
    assert.equal(summary.validationsFailed, 1);
    // Which repair attempts succeeded?
    assert.equal(summary.repairAttempts, 1);
    assert.equal(summary.repairsFixed, 1);
    // Did anything roll back, or exit unexpectedly?
    assert.equal(summary.rollbacks, 1);
    assert.equal(summary.unexpectedProcessExits, 1);
    // And the reason the first thing went wrong, which is usually the cause.
    assert.equal(summary.firstFailureReason, 'provider unreachable');
    assert.equal(summary.costUsd, 0.0002);
  });

  it('reports what nothing measured as null rather than zero', () => {
    const timeline = underContext({ runId: 'run-3' }, () => {
      logEvent({ event: 'stage.start', stage: 'analysis' });
      logEvent({
        event: 'model.call',
        provider: 'groq',
        model: 'openai/gpt-oss-20b',
        outcome: 'cached',
        durationMs: 2,
      });
    });

    const summary = timeline?.summary;
    assert.ok(summary);
    assert.equal(summary.slowestStage, null, 'no stage ended, so there is no slowest one');
    assert.equal(summary.totalStageMs, null);
    assert.equal(summary.validationMs, null, 'nothing validated — not "validated in 0ms"');
    // A cache hit paid nobody and reported no retry count. Neither becomes a
    // measured zero.
    assert.equal(summary.costUsd, null);
    assert.equal(summary.modelRetries, null);
    assert.equal(summary.firstFailureReason, null);
    // Counts of things that did happen are still counts.
    assert.equal(summary.modelCalls, 1);
  });

  it('does not hand one user another user’s timeline', () => {
    underContext({ runId: 'run-4' }, () => {
      logEvent({ event: 'stage.start', stage: 'analysis' });
    });
    assert.ok(getTimeline('run-4', OWNER), 'the owner can read it');
    assert.equal(getTimeline('run-4', 'someone-else'), null, 'not yours reads as not found');
    assert.deepEqual(listTimelines('someone-else'), []);
  });

  it('drops events outside a context instead of inventing a key', () => {
    clearTimelines();
    logEvent({ event: 'stage.start', stage: 'analysis' });
    assert.deepEqual(listTimelines(OWNER), [], 'a startup path has nothing to group by');
  });

  it('says so when it stopped recording rather than looking complete', () => {
    clearTimelines();
    runWithLogContext({ runId: 'run-flood', userId: OWNER }, () => {
      // Past the per-correlation entry cap, which exists so a runaway
      // emitter cannot grow the process.
      for (let i = 0; i < 520; i += 1) logEvent({ event: 'stage.start', stage: `s${String(i)}` });
    });
    const timeline = getTimeline('run-flood', OWNER);
    assert.equal(timeline?.truncated, true);
    assert.ok(timeline.entries.length < 520, 'it stopped collecting');
  });

  it('masks a credential a failure reason dragged in', () => {
    // The log line is redacted by the logger's format chain, which runs on
    // the way to the transports and never touches the timeline's copy.
    // Several kinds build their reason from an error message, and a Prisma
    // connection error carries the credential URL in its text — so this copy
    // has to be redacted on the way in. Without it the log file masked the
    // password and the timeline API served it.
    const timeline = underContext({ runId: 'run-secret' }, () => {
      logEvent({
        event: 'stage.end',
        stage: 'database',
        outcome: 'failed',
        durationMs: 10,
        reason: 'P1001: cannot reach postgresql://admin:SuperSecret123@db.host:5432/nexarch',
      });
    });

    const served = JSON.stringify(timeline);
    assert.ok(!served.includes('SuperSecret123'), 'the password never reaches a reader');
    assert.ok(!served.includes('admin'), 'nor the user it belonged to');
    // And the diagnosis survives, because a redacted line still has to be
    // worth reading.
    assert.match(served, /P1001/);
    assert.match(served, /db\.host/);
  });

  it('admits a timeline that was evicted and came back', () => {
    clearTimelines();
    // A long run's bucket dropped mid-flight used to reappear with a fresh
    // start time and truncated:false, so a half-missing timeline asserted it
    // was complete — and its "slowest stage" was whichever stage survived.
    runWithLogContext({ runId: 'run-long', userId: OWNER }, () => {
      logEvent({ event: 'stage.start', stage: 'analysis' });
    });
    // Push it out with more correlations than the buffer keeps.
    for (let i = 0; i < 60; i += 1) {
      runWithLogContext({ runId: `filler-${String(i)}`, userId: OWNER }, () => {
        logEvent({ event: 'stage.start', stage: 'analysis' });
      });
    }
    assert.equal(getTimeline('run-long', OWNER), null, 'it was evicted');

    runWithLogContext({ runId: 'run-long', userId: OWNER }, () => {
      logEvent({ event: 'stage.end', stage: 'backend', outcome: 'completed', durationMs: 5 });
    });
    assert.equal(
      getTimeline('run-long', OWNER)?.truncated,
      true,
      'the timeline says it is missing events rather than looking complete',
    );
  });

  it('does not let two accounts share a bucket through one request id', () => {
    clearTimelines();
    // A request may supply its own X-Request-Id, and a plain request with no
    // run, job or session groups under it. Keying on that alone meant two
    // accounts sending the same header shared a bucket, and whichever
    // created it could read the other's events.
    runWithLogContext({ requestId: 'shared-trace', userId: 'user-a' }, () => {
      logEvent({ event: 'cleanup', target: 'a-only', outcome: 'removed' });
    });
    runWithLogContext({ requestId: 'shared-trace', userId: 'user-b' }, () => {
      logEvent({ event: 'cleanup', target: 'b-only', outcome: 'removed' });
    });

    const a = getTimeline('shared-trace', 'user-a');
    const b = getTimeline('shared-trace', 'user-b');
    assert.equal(a?.entries.length, 1);
    assert.equal(b?.entries.length, 1);
    assert.ok(!JSON.stringify(a).includes('b-only'), 'A cannot see B’s event');
    assert.ok(!JSON.stringify(b).includes('a-only'), 'nor B A’s');
  });

  it('serves the token figures rather than masking its own counts', () => {
    // The redactor masks any key containing "token", so storing the raw
    // event meant the timeline API served "***" where the log line
    // published real numbers.
    const timeline = underContext({ runId: 'run-usage' }, () => {
      logEvent({
        event: 'model.call',
        provider: 'groq',
        model: 'openai/gpt-oss-20b',
        outcome: 'success',
        durationMs: 900,
        tokens: { inputTokens: 1200, outputTokens: 800 },
      });
    });
    const served = JSON.stringify(timeline);
    assert.ok(!served.includes('***'), 'nothing here is a secret');
    assert.match(served, /"input":1200/);
    assert.match(served, /"output":800/);
  });

  it('keeps one project’s executions separate from another’s', () => {
    clearTimelines();
    runWithLogContext({ runId: 'run-p1', userId: OWNER, projectId: 'project-1' }, () => {
      logEvent({ event: 'stage.start', stage: 'analysis' });
    });
    runWithLogContext({ runId: 'run-p2', userId: OWNER, projectId: 'project-2' }, () => {
      logEvent({ event: 'stage.start', stage: 'analysis' });
    });

    assert.deepEqual(
      listTimelines(OWNER, 'project-1').map((timeline) => timeline.key),
      ['run-p1'],
    );
    assert.equal(listTimelines(OWNER).length, 2, 'unfiltered still lists both');
  });

  it('summarizes an empty timeline without inventing anything', () => {
    const summary = summarize([]);
    assert.equal(summary.slowestStage, null);
    assert.equal(summary.modelCalls, 0);
    assert.equal(summary.retries, 0);
    assert.equal(summary.costUsd, null);
    assert.deepEqual(summary.failedAgents, []);
  });
});
