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
