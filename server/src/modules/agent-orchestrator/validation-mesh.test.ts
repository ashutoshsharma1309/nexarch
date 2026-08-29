/**
 * Validation mesh tests (`npm test`).
 *
 * The live halves — a real npm install, a real session, real HTTP — are
 * exercised by the end-to-end validation runs, not here. What belongs in
 * unit tests is every decision the mesh makes *about* execution evidence:
 * how a plan is derived, how BLOCKED is distinguished from FAILED, which
 * gate rule fires, what a log line is classified as, and what never leaks
 * into output. Each of those is a rule that could silently rot, so each
 * gets a test that would notice.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { analyzeRequirements } from '../analysis/analysis.service.js';
import { planArchitecture } from '../architecture/architecture.service.js';
import { designDatabase } from '../database-designer/database-designer.service.js';
import { generateBackend } from '../backend-generator/backend-generator.service.js';
import { AGENT_DEFINITIONS, getAgentDefinition } from '../../shared/contracts/index.js';
import { buildPlan, computeWaves } from './lib/planner.js';
import {
  collectionPathOf,
  creationPathFor,
  deriveTestPlan,
  payloadFor,
  requiredForeignKeys,
} from './lib/test-plan.js';
import { executeTestPlan } from './lib/test-executor.js';
import { validateIntegration } from './lib/integration-validation.js';
import { scrub } from './lib/runtime-validation.js';
import { summarizeValidation } from './lib/validation-summary.js';
import type { IntegrationResult, RuntimeResult, TestCase } from '../../shared/types/validation.js';

/* ── Fixture: a real e-commerce project ───────────────────────────────── */

const analysis = analyzeRequirements(
  'Build an e-commerce platform with authentication, products, cart, orders, payments and inventory.',
);
assert.equal(analysis.status, 'COMPLETE');
const REQUIREMENTS = analysis.spec;
const ARCHITECTURE = planArchitecture(REQUIREMENTS).plan;
const DESIGN = designDatabase(ARCHITECTURE, REQUIREMENTS);
const BACKEND = generateBackend(
  ARCHITECTURE,
  REQUIREMENTS,
  DESIGN.databaseDesign,
  DESIGN.prismaSchema,
  DESIGN.openapi,
  DESIGN.validationRules.entities,
  DESIGN.entityMetadata,
);

const MODULES = BACKEND.modules.map((mod) => ({
  name: mod.name,
  entity: mod.entity,
  crud: mod.crud,
}));
const ROUTES = BACKEND.routes.map((route) => ({
  method: route.method,
  path: route.path,
  auth: route.auth,
  implemented: route.implemented,
}));

function plan(): TestCase[] {
  return deriveTestPlan({
    projectId: 'p1',
    runId: 'r1',
    api: DESIGN.openapi,
    product: undefined,
    modules: MODULES,
    routes: ROUTES,
    authExpected: true,
  });
}

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
    checks: [],
    endpoints: [],
    durationMs: 1,
    createdAt: '2026-08-27T00:00:00.000Z',
    ...overrides,
  };
}

function doneCase(status: TestCase['status'], priority: TestCase['priority']): TestCase {
  return {
    id: `${status}-${priority}-${String(Math.floor(Math.random() * 1e9))}`,
    projectId: 'p1',
    runId: 'r1',
    agentId: 'test-engineer',
    name: 'x',
    type: 'API',
    priority,
    target: 'x',
    steps: [],
    expectedResult: 'x',
    status,
    duration: 1,
    error: null,
    evidence: 'GET /x → 200',
    createdAt: '2026-08-27T00:00:00.000Z',
  };
}

/* ── Declarations (Steps 2, 24, 25) ───────────────────────────────────── */

describe('validation mesh declarations', () => {
  it('enables the three validation agents, all read-only', () => {
    for (const id of ['runtime-engineer', 'integration-engineer', 'test-engineer'] as const) {
      const definition = getAgentDefinition(id);
      assert.ok(definition, `${id} is not declared`);
      assert.equal(definition.enabled, true);
      assert.deepEqual(definition.mutates, []);
    }
  });

  it('chains runtime → integration → test after the generation mesh', () => {
    const enabled = AGENT_DEFINITIONS.filter((definition) => definition.enabled).map(
      (definition) => definition.id,
    );
    const dagPlan = buildPlan({
      projectId: 'p1',
      runId: 'r1',
      agentIds: enabled,
      priority: 'NORMAL',
    });
    const waves = computeWaves(dagPlan.tasks);
    const agentOf = new Map(dagPlan.tasks.map((task) => [task.id, task.agentId]));
    const waveOf = (agentId: string): number =>
      waves.findIndex((wave) => wave.some((taskId) => agentOf.get(taskId) === agentId));

    assert.ok(waveOf('runtime-engineer') > waveOf('ux-ui-engineer'));
    assert.ok(waveOf('integration-engineer') > waveOf('runtime-engineer'));
    assert.ok(waveOf('test-engineer') > waveOf('integration-engineer'));
  });
});

/* ── Test planning (Steps 3–5) ────────────────────────────────────────── */

describe('test plan derivation', () => {
  it('derives a bounded plan from the project itself, not a template', () => {
    const cases = plan();
    assert.ok(cases.length >= 5, 'too few cases to mean anything');
    assert.ok(cases.length <= 12, `plan inflated to ${String(cases.length)} cases`);
    // The CRUD targets are this project's modules — nothing hard-coded.
    const crudTargets = cases
      .filter(
        (testCase) =>
          testCase.type === 'API' &&
          testCase.target !== 'authentication' &&
          testCase.target !== 'authorization',
      )
      .map((testCase) => testCase.target);
    for (const target of crudTargets) {
      assert.ok(
        MODULES.some((mod) => mod.name === target),
        `${target} is not a module of this project`,
      );
    }
  });

  it('plans one end-to-end lifecycle, not a hundred', () => {
    const e2e = plan().filter((testCase) => testCase.type === 'E2E');
    assert.equal(e2e.length, 1);
    assert.equal(e2e[0]?.priority, 'CRITICAL');
    assert.ok(e2e[0].steps.length >= 3);
  });

  it('skips auth cases when the requirements never asked for auth', () => {
    const cases = deriveTestPlan({
      projectId: 'p1',
      runId: 'r1',
      api: DESIGN.openapi,
      product: undefined,
      modules: MODULES,
      routes: ROUTES,
      authExpected: false,
    });
    assert.ok(!cases.some((testCase) => testCase.target === 'authentication'));
  });

  it('finds each module’s collection path from the real routes', () => {
    const first = MODULES.find((mod) => mod.crud);
    assert.ok(first);
    const path = collectionPathOf(ROUTES, first.name);
    assert.ok(path, `no collection path for ${first.name}`);
    assert.ok(path.startsWith('/'));
    assert.ok(!path.includes(':'), 'collection path should not carry a param');
  });

  it('builds create payloads from the contract’s own required fields', () => {
    // Auth operations carry a bare object schema; entity creates carry a
    // $ref into components. The payload builder must handle the second and
    // admit it cannot help with the first.
    const paths = Object.keys(DESIGN.openapi.paths);
    const entityPost = paths.find(
      (path) =>
        !path.includes('auth') &&
        (DESIGN.openapi.paths as Record<string, Record<string, unknown>>)[path]?.post,
    );
    assert.ok(entityPost, 'the contract declares no entity POST');
    const payload = payloadFor(DESIGN.openapi, entityPost, 'POST', 'seed1');
    assert.ok(payload, `no payload derivable for POST ${entityPost}`);
    assert.ok(Object.keys(payload).length > 0, 'payload is empty despite required fields');

    const authPost = paths.find((path) => path.includes('auth'));
    if (authPost) {
      assert.equal(payloadFor(DESIGN.openapi, authPost, 'POST', 'seed1'), null);
    }
  });
});

describe('lessons from the first live run', () => {
  /**
   * Three harness defects the first end-to-end validation surfaced, each
   * of which failed a test against a correctly-behaving application.
   */
  it('embeds a real guarded path in the authorization case', () => {
    const authz = plan().find((testCase) => testCase.target === 'authorization');
    assert.ok(authz);
    const action = authz.steps[0]?.action ?? '';
    const path = /GET (\S+)/.exec(action)?.[1] ?? '';
    assert.notEqual(path, '/', 'the placeholder path is back');
    assert.ok(
      ROUTES.some((route) => route.path.endsWith(path)),
      `${path} is not a route of this project`,
    );
  });

  it('generates a UUID for uuid-format fields, not prose', () => {
    const paths = Object.keys(DESIGN.openapi.paths);
    for (const path of paths) {
      const fks = requiredForeignKeys(DESIGN.openapi, path);
      if (fks.length === 0) continue;
      const payload = payloadFor(DESIGN.openapi, path, 'POST', 'seed1');
      assert.ok(payload);
      const fk = fks[0];
      assert.ok(fk);
      assert.match(
        String(payload[fk.field]),
        /^[0-9a-f-]{36}$/,
        `${fk.field} should be a UUID, got ${String(payload[fk.field])}`,
      );
      return; // one FK-bearing path is enough
    }
  });

  it('plans FK-free creates ahead of FK-requiring ones', () => {
    const crud = plan().filter(
      (testCase) =>
        testCase.type === 'API' &&
        !['authentication', 'authorization'].includes(testCase.target) &&
        !testCase.name.includes('empty payload'),
    );
    assert.ok(crud.length > 0);
    const first = crud[0];
    assert.ok(first);
    const path = /POST (\S+)/.exec(first.steps[0]?.action ?? '')?.[1] ?? '';
    assert.deepEqual(
      requiredForeignKeys(DESIGN.openapi, path),
      [],
      `the first-planned CRUD module (${first.target}) requires a foreign key`,
    );
  });

  it('finds the endpoint that can satisfy a foreign key', () => {
    // Products are creatable; whatever references Users is not, because
    // users are born only through auth. Both answers must be honest.
    const products = creationPathFor(DESIGN.openapi, 'Products');
    assert.ok(products, 'Products should have a creatable endpoint');
  });
});

/* ── BLOCKED versus FAILED (Steps 6, 25) ──────────────────────────────── */

describe('blocked versus failed', () => {
  it('blocks every test when the runtime never started — none fail', async () => {
    const cases = plan();
    const execution = await executeTestPlan({
      cases,
      api: DESIGN.openapi,
      backendBaseUrl: null,
      frontendBaseUrl: null,
      apiPrefix: '/api/v1',
      runId: 'r1',
      runtimeUp: false,
    });
    assert.ok(execution.cases.length > 0);
    for (const testCase of execution.cases) {
      assert.equal(testCase.status, 'BLOCKED', `${testCase.name} should be BLOCKED`);
      assert.ok(testCase.evidence, 'even a blocked test carries its evidence');
    }
    assert.equal(execution.results.filter((result) => result.status === 'FAILED').length, 0);
  });

  it('blocks integration checks when there is nothing live to check', async () => {
    const validation = await validateIntegration({
      projectId: 'p1',
      runId: 'r1',
      api: DESIGN.openapi,
      runtime: runtimeResult({ startupStatus: 'FAIL' }),
      backendBaseUrl: null,
      frontendBaseUrl: null,
      apiPrefix: '/api/v1',
    });
    assert.ok(validation.result.checks.length > 0);
    for (const check of validation.result.checks) {
      assert.equal(check.status, 'BLOCKED');
    }
    // No findings fabricated about an application that never answered.
    assert.deepEqual(validation.findings, []);
  });
});

/* ── The gate (Steps 32–33) ───────────────────────────────────────────── */

describe('quality gate', () => {
  const agents = [{ agentId: 'runtime-engineer', status: 'COMPLETED' as const, durationMs: 1 }];

  it('fails when the project does not compile', () => {
    const summary = summarizeValidation({
      projectId: 'p1',
      runId: 'r1',
      runtime: runtimeResult({ typeCheckStatus: 'FAIL' }),
      integration: integrationResult(),
      cases: [doneCase('PASSED', 'CRITICAL')],
      agents,
    });
    assert.equal(summary.gate, 'FAILED');
    assert.match(summary.gateReason, /compile/);
  });

  it('fails when the application does not start', () => {
    const summary = summarizeValidation({
      projectId: 'p1',
      runId: 'r1',
      runtime: runtimeResult({ startupStatus: 'FAIL' }),
      integration: null,
      cases: [],
      agents,
    });
    assert.equal(summary.gate, 'FAILED');
    assert.match(summary.gateReason, /did not start/);
  });

  it('is BLOCKED, not failed, when the runtime is up but nothing else ran', () => {
    const summary = summarizeValidation({
      projectId: 'p1',
      runId: 'r1',
      runtime: runtimeResult(),
      integration: null,
      cases: [],
      agents,
    });
    assert.equal(summary.gate, 'BLOCKED');
  });

  it('fails on a critical test failure, warns on a non-critical one', () => {
    const critical = summarizeValidation({
      projectId: 'p1',
      runId: 'r1',
      runtime: runtimeResult(),
      integration: integrationResult(),
      cases: [doneCase('FAILED', 'CRITICAL'), doneCase('PASSED', 'HIGH')],
      agents,
    });
    assert.equal(critical.gate, 'FAILED');

    const warned = summarizeValidation({
      projectId: 'p1',
      runId: 'r1',
      runtime: runtimeResult(),
      integration: integrationResult(),
      cases: [doneCase('FAILED', 'HIGH'), doneCase('PASSED', 'CRITICAL')],
      agents,
    });
    assert.equal(warned.gate, 'PASSED_WITH_WARNINGS');
  });

  it('passes only when everything ran and passed, and says why', () => {
    const summary = summarizeValidation({
      projectId: 'p1',
      runId: 'r1',
      runtime: runtimeResult(),
      integration: integrationResult({
        checks: [{ kind: 'API_CONTRACT', name: 'x', status: 'PASS', evidence: 'e', error: null }],
      }),
      cases: [doneCase('PASSED', 'CRITICAL'), doneCase('PASSED', 'HIGH')],
      agents,
    });
    assert.equal(summary.gate, 'PASSED');
    assert.ok(summary.gateReason.length > 0);
    // The rows are counted from the inputs, not asserted.
    const tests = summary.rows.find((row) => row.name === 'Tests');
    assert.match(tests?.detail ?? '', /2\/2 passed/);
  });

  it('never claims validation that did not happen', () => {
    const summary = summarizeValidation({
      projectId: 'p1',
      runId: 'r1',
      runtime: null,
      integration: null,
      cases: [],
      agents: [],
    });
    assert.equal(summary.gate, 'NOT_VALIDATED');
  });
});

/* ── Evidence hygiene (Steps 11, 17, 23) ──────────────────────────────── */

describe('evidence hygiene', () => {
  it('scrubs credentials out of anything that leaves the mesh', () => {
    const dirty =
      'DATABASE_URL=mysql://runner:supersecret@localhost:3307/db password: hunter2 gsk_abcdefghijklmnop123456';
    const clean = scrub(dirty);
    assert.ok(!clean.includes('supersecret'));
    assert.ok(!clean.includes('hunter2'));
    assert.ok(!clean.includes('gsk_abcdefghijklmnop123456'));
    assert.ok(clean.includes('runner:***@'), 'the shape survives, the secret does not');
  });

  it('uses disposable, namespaced test data only', () => {
    // The executor derives its identities from the run id and an invalid
    // TLD — verify the construction stays that way.
    const cases = plan();
    const authCase = cases.find((testCase) => testCase.target === 'authentication');
    assert.ok(authCase);
    assert.match(authCase.steps[0]?.action ?? '', /disposable/);
  });
});
