/**
 * Unevidenced-success tests for the gate and the executor (`npm test`).
 *
 * The gate's sentence is the authoritative verdict: the Builder Agent reads
 * `state.validationGate` and the reason is shown to the user. So the thing
 * worth testing is not that a good run passes — it is that a run in which
 * nothing actually executed cannot pass, and cannot describe itself as
 * having passed. Every case below is a shape that once produced PASSED and
 * the sentence "every planned test passed" against a project whose build
 * and typecheck scripts did not exist and whose plan was entirely skipped.
 *
 * The executor cases use a throwaway local HTTP server rather than mocks,
 * because the defects being pinned are about believing a real response:
 * a 200 login with no token, and a 201 create with no id.
 */
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { describe, it } from 'node:test';

import { executeTestPlan } from './lib/test-executor.js';
import { summarizeValidation } from './lib/validation-summary.js';
import type { OpenApiDocument } from '../../shared/types/design.js';
import type { IntegrationResult, RuntimeResult, TestCase } from '../../shared/types/validation.js';

/* ── Fixtures ─────────────────────────────────────────────────────────── */

const AGENTS = [{ agentId: 'test-engineer', status: 'COMPLETED' as const, durationMs: 1 }];

function runtimeResult(overrides: Partial<RuntimeResult> = {}): RuntimeResult {
  return {
    projectId: 'p1',
    runId: 'r1',
    sessionId: 's1',
    workspaceDir: '/tmp/x',
    buildStatus: 'PASS',
    typeCheckStatus: 'PASS',
    lintStatus: 'PASS',
    startupStatus: 'PASS',
    healthStatus: 'PASS',
    processStatus: 'PASS',
    commands: [],
    processes: [],
    logSignals: [],
    durationMs: 1,
    errors: [],
    createdAt: '2026-08-27T00:00:00.000Z',
    ...overrides,
  };
}

function integrationResult(overrides: Partial<IntegrationResult> = {}): IntegrationResult {
  return {
    projectId: 'p1',
    runId: 'r1',
    baseUrl: 'http://localhost:1',
    checks: [{ kind: 'API_CONTRACT', name: 'x', status: 'PASS', evidence: 'e', error: null }],
    endpoints: [],
    durationMs: 1,
    createdAt: '2026-08-27T00:00:00.000Z',
    ...overrides,
  };
}

function testCase(overrides: Partial<TestCase> = {}): TestCase {
  return {
    id: `case-${String(Math.floor(Math.random() * 1e9))}`,
    projectId: 'p1',
    runId: 'r1',
    agentId: 'test-engineer',
    name: 'widgets create and read back',
    type: 'API',
    priority: 'HIGH',
    target: 'widgets',
    steps: [{ action: 'POST /widgets with a valid payload', expect: '201 and an id' }],
    expectedResult: 'the record comes back',
    status: 'PENDING',
    duration: 1,
    error: null,
    evidence: null,
    createdAt: '2026-08-27T00:00:00.000Z',
    ...overrides,
  };
}

function cases(statuses: readonly TestCase['status'][]): TestCase[] {
  return statuses.map((status) => testCase({ status }));
}

function summarize(
  runtime: RuntimeResult | null,
  integration: IntegrationResult | null,
  planned: TestCase[],
): ReturnType<typeof summarizeValidation> {
  return summarizeValidation({
    projectId: 'p1',
    runId: 'r1',
    runtime,
    integration,
    cases: planned,
    agents: AGENTS,
  });
}

function rowOf(
  summary: ReturnType<typeof summarizeValidation>,
  name: string,
): { name: string; status: string; detail: string } {
  const found = summary.rows.find((row) => row.name === name);
  assert.ok(found, `no ${name} row in the summary`);
  return found;
}

/* ── The gate cannot pass what did not run ────────────────────────────── */

describe('gate: a run in which nothing executed', () => {
  it('does not pass when the plan was written but entirely skipped', () => {
    const summary = summarize(
      runtimeResult({ buildStatus: 'SKIPPED', typeCheckStatus: 'SKIPPED' }),
      integrationResult(),
      cases(['SKIPPED', 'SKIPPED', 'SKIPPED']),
    );
    assert.notEqual(summary.gate, 'PASSED');
    assert.equal(summary.gate, 'BLOCKED');
  });

  it('never says a test passed when every test was skipped', () => {
    const summary = summarize(
      runtimeResult({ buildStatus: 'SKIPPED', typeCheckStatus: 'SKIPPED' }),
      integrationResult(),
      cases(['SKIPPED', 'SKIPPED', 'SKIPPED']),
    );
    assert.ok(
      !/pass/i.test(summary.gateReason),
      `the reason still claims a pass: ${summary.gateReason}`,
    );
    assert.match(summary.gateReason, /3 skipped/);
  });

  it('does not pass when the plan was entirely blocked', () => {
    const summary = summarize(runtimeResult(), integrationResult(), cases(['BLOCKED', 'BLOCKED']));
    assert.equal(summary.gate, 'BLOCKED');
  });

  it('warns, rather than passes, when build and typecheck never ran', () => {
    const summary = summarize(
      runtimeResult({ buildStatus: 'SKIPPED', typeCheckStatus: 'SKIPPED' }),
      integrationResult(),
      cases(['PASSED', 'PASSED']),
    );
    assert.equal(summary.gate, 'PASSED_WITH_WARNINGS');
    assert.match(summary.gateReason, /build SKIPPED/);
    assert.match(summary.gateReason, /typecheck SKIPPED/);
  });

  it('counts a partly-skipped plan as a warning and says how many skipped', () => {
    const summary = summarize(
      runtimeResult(),
      integrationResult(),
      cases(['PASSED', 'SKIPPED', 'SKIPPED']),
    );
    assert.equal(summary.gate, 'PASSED_WITH_WARNINGS');
    assert.match(summary.gateReason, /2 of 3 planned test\(s\) SKIPPED/);
  });
});

describe('gate: the Tests row', () => {
  it('is not PASS when nothing passed, and states the skipped count', () => {
    const summary = summarize(runtimeResult(), integrationResult(), cases(['SKIPPED', 'SKIPPED']));
    const tests = rowOf(summary, 'Tests');
    assert.notEqual(tests.status, 'PASS');
    assert.equal(tests.status, 'SKIPPED');
    assert.match(tests.detail, /0\/2 passed/);
    assert.match(tests.detail, /2 skipped/);
  });

  it('is BLOCKED when the cases were blocked rather than skipped', () => {
    const summary = summarize(runtimeResult(), integrationResult(), cases(['BLOCKED', 'BLOCKED']));
    assert.equal(rowOf(summary, 'Tests').status, 'BLOCKED');
  });
});

describe('gate: a run that really did pass', () => {
  it('still passes, and names what ran', () => {
    const summary = summarize(runtimeResult(), integrationResult(), cases(['PASSED', 'PASSED']));
    assert.equal(summary.gate, 'PASSED');
    assert.match(summary.gateReason, /build/);
    assert.match(summary.gateReason, /typecheck/);
    assert.match(summary.gateReason, /2 of 2 planned test\(s\)/);
    assert.equal(rowOf(summary, 'Tests').status, 'PASS');
    assert.match(rowOf(summary, 'Tests').detail, /2\/2 passed/);
  });
});

/* ── The executor cannot pass a response that proved nothing ──────────── */

const API: OpenApiDocument = {
  openapi: '3.1.0',
  info: { title: 'probe', version: '1.0.0', description: 'fixture' },
  servers: [],
  tags: [],
  paths: {},
  components: { securitySchemes: {}, parameters: {}, responses: {}, schemas: {} },
};

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

/** Serves `handler` on a throwaway port for the duration of `body`. */
async function withServer(handler: Handler, body: (base: string) => Promise<void>): Promise<void> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve();
    });
  });
  const address = server.address();
  assert.ok(address !== null && typeof address === 'object', 'the probe server has no port');
  try {
    await body(`http://127.0.0.1:${String(address.port)}`);
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  }
}

function send(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(payload));
}

describe('executor: responses that prove nothing', () => {
  it('fails the auth round trip when login returns 200 with no token', async () => {
    await withServer(
      (request, response) => {
        const path = request.url ?? '';
        if (path.endsWith('/auth/register')) {
          send(response, 201, { data: {} });
        } else if (path.endsWith('/auth/login')) {
          send(response, 200, { data: { ok: true } });
        } else {
          send(response, 200, { data: [] });
        }
      },
      async (base) => {
        const authCase = testCase({ target: 'authentication', name: 'register then login' });
        const execution = await executeTestPlan({
          cases: [authCase],
          api: API,
          backendBaseUrl: base,
          frontendBaseUrl: null,
          apiPrefix: '/api/v1',
          runId: '0123456789abcdef',
          runtimeUp: true,
        });
        const [authResult] = execution.cases;
        assert.ok(authResult, 'the plan had one case, so there is one result');
        assert.equal(authResult.status, 'FAILED');
        assert.match(authResult.error ?? '', /no access token/);
      },
    );
  });

  it('passes the auth round trip when a token actually comes back', async () => {
    await withServer(
      (request, response) => {
        const path = request.url ?? '';
        if (path.endsWith('/auth/register')) {
          send(response, 201, { data: {} });
        } else if (path.endsWith('/auth/login')) {
          send(response, 200, { data: { token: 't0ken' } });
        } else {
          send(response, 200, { data: [] });
        }
      },
      async (base) => {
        const authCase = testCase({ target: 'authentication', name: 'register then login' });
        const execution = await executeTestPlan({
          cases: [authCase],
          api: API,
          backendBaseUrl: base,
          frontendBaseUrl: null,
          apiPrefix: '/api/v1',
          runId: '0123456789abcdef',
          runtimeUp: true,
        });
        assert.equal(execution.cases[0]?.status, 'PASSED');
        assert.equal(execution.credentials.mode, 'real-login');
      },
    );
  });

  it('skips create-and-read when the create returns no id to look for', async () => {
    await withServer(
      (request, response) => {
        const path = request.url ?? '';
        if (path.endsWith('/auth/register')) {
          send(response, 201, { data: {} });
        } else if (path.endsWith('/auth/login')) {
          send(response, 200, { data: { token: 't0ken' } });
        } else if (request.method === 'POST') {
          send(response, 201, { data: { name: 'w' } });
        } else {
          send(response, 200, { data: [] });
        }
      },
      async (base) => {
        const crud = testCase();
        const execution = await executeTestPlan({
          cases: [crud],
          api: API,
          backendBaseUrl: base,
          frontendBaseUrl: null,
          apiPrefix: '/api/v1',
          runId: '0123456789abcdef',
          runtimeUp: true,
        });
        const [crudResult] = execution.cases;
        assert.ok(crudResult, 'the plan had one case, so there is one result');
        assert.equal(crudResult.status, 'SKIPPED');
        assert.match(crudResult.evidence ?? '', /no id/);
      },
    );
  });
});
