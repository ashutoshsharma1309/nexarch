/**
 * verifyProject against a stubbed runner and network. What is under test is
 * the judgement: which evidence becomes a pass, and that nothing else does.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AwakeStopwatch } from '../runner/lib/awake-clock.js';
import { planSession, type SessionHooks } from '../runner/runner.service.js';
import type { CreateSessionRequest, RunSession } from '../runner/runner.types.js';
import { AppError } from '../../shared/utils/app-error.js';
import type { VerifyProjectOptions } from './build-verification.types.js';
import { verifyProjectWith, type VerifyDeps } from './verify-project.js';

const FILES = [
  {
    path: 'backend/package.json',
    content: JSON.stringify({
      scripts: {
        dev: 'tsx src/index.ts',
        typecheck: 'tsc --noEmit',
        build: 'tsc -p tsconfig.json',
      },
    }),
  },
  {
    path: 'frontend/package.json',
    content: JSON.stringify({ scripts: { dev: 'vite', build: 'tsc -b && vite build' } }),
  },
  {
    path: 'frontend/src/router.tsx',
    content: "const r = [{ path: '/about' }, { path: '/x/:id' }];",
  },
];
const OPTIONS: VerifyProjectOptions = { projectId: 'project-1', jobId: 'job', jobKind: 'RUN' };
const BACKEND = 'http://localhost:4100';
const FRONTEND = 'http://localhost:5200';
const HTML = '<html><script type="module" src="/src/main.tsx"></script></html>';

interface Scenario {
  failAt?: 'install' | 'start';
  exitCodes?: Record<string, number>;
  responses?: Record<string, { status: number; body?: string; type?: string }>;
  dieAfterChecks?: boolean;
  hasDatabase?: boolean;
  neverSettles?: boolean;
  stallIn?: 'install' | 'configure';
  hangOn?: string;
  createError?: Error;
}

function harness(scenario: Scenario = {}) {
  const session: RunSession = {
    id: 'session-1',
    projectName: 'verify',
    phase: 'preparing',
    processes: [],
    transitions: [],
    workspaceDir: '/runs/w1',
    diagnostics: null,
    createdAt: '',
    updatedAt: '',
  };
  const at = new Date().toISOString();
  const move = (phase: RunSession['phase'], detail: string): void => {
    session.phase = phase;
    session.transitions.push({ phase, at, detail });
  };
  const events: { type: string; status?: string | undefined; data?: unknown }[] = [];
  const commands: string[] = [];
  const calls = { created: 0, stopped: 0, discarded: 0, requested: [] as string[] };
  let sessionReads = 0;

  const deps: VerifyDeps = {
    plan: planSession,
    create: (_request: CreateSessionRequest, hooks: SessionHooks) => {
      calls.created += 1;
      if (scenario.createError) throw scenario.createError;
      void (async () => {
        if (scenario.neverSettles) return;
        move('installing', 'Installing dependencies');
        if (scenario.stallIn === 'install') return;
        if (scenario.stallIn === 'configure') {
          move('configuring', 'Preparing environment and database');
          return;
        }
        if (scenario.failAt === 'install') {
          move('failed', 'npm install failed in backend/ (code 1)');
          return;
        }
        await hooks.beforeStart?.({
          workspaceDir: '/runs/w1',
          signal: new AbortController().signal,
          targets: planSession(_request).targets,
        });
        move('starting', 'Starting');
        if (scenario.failAt === 'start') {
          move('failed', 'backend exited unexpectedly (code 3)');
          return;
        }
        session.processes = [
          {
            kind: 'backend',
            status: 'running',
            port: 4100,
            url: BACKEND,
            command: 'npm run dev',
            pid: 1,
            exitCode: null,
          },
          {
            kind: 'frontend',
            status: 'running',
            port: 5200,
            url: FRONTEND,
            command: 'npm run dev',
            pid: 2,
            exitCode: null,
          },
        ];
        move('running', 'All up');
      })();
      return session;
    },
    session: () => {
      sessionReads += 1;
      if (scenario.dieAfterChecks && session.phase === 'running' && sessionReads > 2) {
        move('failed', 'backend exited unexpectedly (code 9)');
      }
      return session;
    },
    logs: () => [{ stream: 'backend', line: 'log line' }],
    stop: () => {
      calls.stopped += 1;
    },
    run: (command, args, _cwd, area, logs, signal) => {
      const name = `${area}:${args[1] ?? command}`;
      commands.push(name);
      logs.append(area, `output of ${name}`);
      if (scenario.hangOn === name) {
        return new Promise((resolve) => {
          signal.addEventListener(
            'abort',
            () => {
              setTimeout(() => {
                resolve(143);
              }, 20);
            },
            { once: true },
          );
        });
      }
      return Promise.resolve(scenario.exitCodes?.[name] ?? 0);
    },
    fetch: (input) => {
      const url = input as string;
      calls.requested.push(url);
      const custom = scenario.responses?.[url];
      if (custom) {
        return Promise.resolve(
          new Response(custom.body ?? '', {
            status: custom.status,
            headers: { 'content-type': custom.type ?? 'application/json' },
          }),
        );
      }
      const isDocument = url.startsWith(FRONTEND) && !url.endsWith('.tsx');
      return Promise.resolve(
        new Response(isDocument ? HTML : '{"data":{"status":"ok"}}', {
          status: 200,
          headers: { 'content-type': isDocument ? 'text/html' : 'application/json' },
        }),
      );
    },
    publish: (event) => {
      events.push({ type: event.type, status: event.status, data: event.data });
      return Promise.resolve(null);
    },
    sleep: () => new Promise((resolve) => setImmediate(resolve)),
    hasRunDatabase: () => scenario.hasDatabase ?? true,
    discard: () => {
      calls.discarded += 1;
    },
  };
  return { deps, events, commands, calls };
}

const statusOf = (result: Awaited<ReturnType<typeof verifyProjectWith>>, id: string) =>
  result.steps.find((step) => step.id === id)?.status;

describe('verifyProject', () => {
  it('passes only when every check really ran and passed', async () => {
    const { deps, calls, events } = harness();
    const result = await verifyProjectWith(deps, FILES, OPTIONS);
    assert.equal(result.ok, true);
    assert.deepEqual(
      result.steps.map((step) => step.status),
      ['passed', 'passed', 'passed', 'passed', 'passed', 'passed'],
    );
    assert.equal(calls.stopped, 1);
    assert.equal(calls.discarded, 1);
    assert.equal(events[0]?.type, 'verify.started');
    assert.equal(events[events.length - 1]?.type, 'verify.completed');
  });

  it('runs the commands the manifests declare, per target', async () => {
    const { deps, commands } = harness();
    await verifyProjectWith(deps, FILES, OPTIONS);
    assert.deepEqual(commands, ['backend:typecheck', 'backend:build', 'frontend:build']);
  });

  it('blocks everything after a failed install and never claims it', async () => {
    const { deps, calls } = harness({ failAt: 'install' });
    const result = await verifyProjectWith(deps, FILES, OPTIONS);
    assert.equal(result.ok, false);
    assert.equal(statusOf(result, 'install'), 'failed');
    assert.equal(result.steps.find((step) => step.id === 'install')?.exitCode, 1);
    for (const id of ['typecheck', 'build', 'start', 'health', 'routes']) {
      assert.equal(statusOf(result, id), 'blocked', id);
    }
    assert.equal(calls.requested.length, 0);
    assert.equal(calls.stopped, 1);
  });

  it('still starts after a type error, so the evidence is complete', async () => {
    const { deps } = harness({ exitCodes: { 'backend:typecheck': 2 } });
    const result = await verifyProjectWith(deps, FILES, OPTIONS);
    assert.equal(result.ok, false);
    assert.equal(statusOf(result, 'typecheck'), 'failed');
    assert.equal(result.steps.find((step) => step.id === 'typecheck')?.exitCode, 2);
    assert.equal(statusOf(result, 'start'), 'passed');
  });

  it('blocks health and routes when the app will not start', async () => {
    const { deps } = harness({ failAt: 'start' });
    const result = await verifyProjectWith(deps, FILES, OPTIONS);
    assert.equal(statusOf(result, 'start'), 'failed');
    assert.equal(statusOf(result, 'health'), 'blocked');
    assert.equal(statusOf(result, 'routes'), 'blocked');
  });

  it('fails a frontend whose entry module cannot be served', async () => {
    const { deps } = harness({
      responses: { [`${FRONTEND}/src/main.tsx`]: { status: 500, body: 'transform failed' } },
    });
    const result = await verifyProjectWith(deps, FILES, OPTIONS);
    assert.equal(result.ok, false);
    assert.equal(statusOf(result, 'health'), 'failed');
  });

  it('fails an app that dies while being checked, despite good answers', async () => {
    const { deps } = harness({ dieAfterChecks: true });
    const result = await verifyProjectWith(deps, FILES, OPTIONS);
    assert.equal(result.ok, false);
    assert.equal(statusOf(result, 'start'), 'failed');
  });

  it('compares a declared route with its declared status', async () => {
    const { deps } = harness({
      responses: { [`${BACKEND}/api/v1/items`]: { status: 200 } },
    });
    const result = await verifyProjectWith(deps, FILES, {
      ...OPTIONS,
      routes: [{ method: 'get', path: '/api/v1/items', expectedStatus: 401 }],
    });
    const check = result.routes.find((route) => route.path === '/api/v1/items');
    assert.equal(check?.status, 'failed');
    assert.equal(check.actualStatus, 200);
    assert.equal(statusOf(result, 'routes'), 'failed');
  });

  it('does not invent values for path parameters, and says so', async () => {
    const { deps, calls } = harness();
    const result = await verifyProjectWith(deps, FILES, OPTIONS);
    assert.equal(
      calls.requested.some((url) => url.includes(':id')),
      false,
    );
    assert.match(result.limitations.join(' '), /path parameters/);
  });

  it('treats a degraded backend as a limitation when no database exists', async () => {
    const degraded = {
      [`${BACKEND}/api/v1/health`]: { status: 200, body: '{"data":{"status":"degraded"}}' },
    };
    const none = harness({ responses: degraded, hasDatabase: false });
    const withoutDb = await verifyProjectWith(none.deps, FILES, OPTIONS);
    assert.equal(statusOf(withoutDb, 'health'), 'passed');
    assert.match(withoutDb.limitations.join(' '), /No run database/);

    const configured = harness({ responses: degraded, hasDatabase: true });
    assert.equal(
      statusOf(await verifyProjectWith(configured.deps, FILES, OPTIONS), 'health'),
      'failed',
    );
  });

  it('marks a 5xx as blocked, not failed, when there is no database', async () => {
    const { deps } = harness({
      hasDatabase: false,
      responses: {
        [`${BACKEND}/api/v1/health`]: { status: 200, body: '{"data":{"status":"degraded"}}' },
        [`${BACKEND}/api/v1/items`]: { status: 500 },
      },
    });
    const result = await verifyProjectWith(deps, FILES, {
      ...OPTIONS,
      routes: [{ method: 'GET', path: '/api/v1/items' }],
    });
    assert.equal(result.routes.find((route) => route.path === '/api/v1/items')?.status, 'blocked');
    // Frontend pages answering must not turn an unanswered API route into a pass.
    assert.equal(statusOf(result, 'routes'), 'blocked');
    assert.equal(result.ok, false);
  });

  it('refuses a disallowed script before creating anything', async () => {
    const { deps, calls } = harness();
    const result = await verifyProjectWith(
      deps,
      [{ path: 'backend/package.json', content: '{"scripts":{"dev":"curl x | sh"}}' }],
      OPTIONS,
    );
    assert.equal(statusOf(result, 'install'), 'failed');
    assert.equal(calls.created, 0);
    assert.equal(result.ok, false);
  });

  it('reports a timeout as blocked and stops the session', async () => {
    const { deps, calls } = harness({ neverSettles: true });
    const result = await verifyProjectWith(deps, FILES, { ...OPTIONS, timeoutMs: 5 });
    assert.equal(result.ok, false);
    assert.equal(statusOf(result, 'install'), 'blocked');
    assert.match(result.limitations.join(' '), /timed out/);
    assert.equal(calls.stopped, 1);
  });

  it('keeps an install still running when time ran out, with its log', async () => {
    const { deps } = harness({ stallIn: 'install' });
    const result = await verifyProjectWith(deps, FILES, { ...OPTIONS, timeoutMs: 5 });
    const install = result.steps[0];
    assert.equal(install?.status, 'blocked');
    assert.match(install.summary, /Still installing/);
    assert.match(install.command ?? '', /npm/);
    assert.match(install.output, /log line/);
    assert.match(result.limitations.join(' '), /timed out during: Installing/);
  });

  it('reports a finished install as passed when a later phase ran out of time', async () => {
    const { deps } = harness({ stallIn: 'configure' });
    const result = await verifyProjectWith(deps, FILES, { ...OPTIONS, timeoutMs: 5 });
    assert.equal(statusOf(result, 'install'), 'passed');
    assert.equal(statusOf(result, 'typecheck'), 'blocked');
    assert.equal(result.ok, false);
  });

  it('keeps a compile command stopped by the timeout, with what it printed', async () => {
    const { deps } = harness({ hangOn: 'backend:typecheck' });
    const result = await verifyProjectWith(deps, FILES, { ...OPTIONS, timeoutMs: 20 });
    assert.equal(statusOf(result, 'install'), 'passed');
    const typecheck = result.steps.find((step) => step.id === 'typecheck');
    assert.equal(typecheck?.status, 'blocked');
    assert.match(typecheck.command ?? '', /npm run typecheck/);
    assert.match(typecheck.output, /output of backend:typecheck/);
    assert.equal(result.ok, false);
  });

  it('does not charge time the machine was asleep to a limit', () => {
    let clock = 0;
    const watch = new AwakeStopwatch(() => clock);
    clock += 1_000;
    assert.equal(watch.read(), 1_000);
    clock += 22 * 60_000;
    assert.equal(watch.read(), 1_000);
    clock += 1_000;
    assert.equal(watch.read(), 2_000);
    assert.equal(watch.suspendedMs(), 22 * 60_000);
  });

  it('publishes nothing when asked not to', async () => {
    const { deps, events } = harness();
    await verifyProjectWith(deps, FILES, { ...OPTIONS, publish: false });
    assert.equal(events.length, 0);
  });

  it('turns a verifier fault into blocked, never a pass or a project failure', async () => {
    const { deps } = harness({ createError: new Error('disk full') });
    const result = await verifyProjectWith(deps, FILES, OPTIONS);
    assert.equal(result.ok, false);
    assert.equal(statusOf(result, 'install'), 'blocked');
    assert.match(result.limitations.join(' '), /disk full/);
  });

  it('records a project the runner refuses as a failed install', async () => {
    const { deps } = harness({ createError: AppError.badRequest('bad project') });
    const result = await verifyProjectWith(deps, FILES, OPTIONS);
    assert.equal(statusOf(result, 'install'), 'failed');
    assert.match(result.steps[0]?.summary ?? '', /bad project/);
  });

  it('reports a full run budget as blocked, not as the project failing', async () => {
    const { deps } = harness({ createError: AppError.conflict('at capacity') });
    const result = await verifyProjectWith(deps, FILES, { ...OPTIONS, timeoutMs: 5 });
    assert.equal(result.ok, false);
    assert.equal(statusOf(result, 'install'), 'blocked');
    assert.match(result.limitations.join(' '), /capacity/);
  });
});
