/**
 * Agent runtime tests (`npm test`).
 *
 * The orchestrator's value is entirely in what it refuses to do, so these
 * concentrate there: does a task with missing inputs stay blocked, does a
 * deterministic failure avoid a pointless retry, does a timeout end rather
 * than hang, does resume skip work that already succeeded, and does an
 * agent that strays outside its declared outputs get rejected.
 *
 * Agents here are fakes registered against the real declarations. That is
 * deliberate — the point is to exercise the *runtime*, and driving it with
 * real model calls would make these slow, costly and non-deterministic.
 * The three real adapters are exercised end to end against a live server
 * separately.
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { getAgentDefinition } from '../../shared/contracts/index.js';
import { AgentError, classify, executeAgent, validateResult } from './lib/executor.js';
import { buildPlan, computeWaves, orderByPriority } from './lib/planner.js';
import {
  getAgent,
  hasAgent,
  listDefinitions,
  registerAgent,
  resetRegistryForTests,
  resolveDependencies,
  runnableAgents,
} from './lib/registry.js';
import { readiness } from './lib/scheduler.js';
import type {
  Agent,
  AgentExecutionInput,
  AgentId,
  AgentResult,
} from '../../shared/contracts/index.js';
import type { AgentRun, AgentTask } from './agent-orchestrator.types.js';

/** Throws rather than asserting non-null: a missing declaration is a real failure. */
function declared(id: AgentId) {
  const definition = getAgentDefinition(id);
  assert.ok(definition, `${id} is not declared`);
  return definition;
}

/* ── Fakes ────────────────────────────────────────────────────────────── */

interface FakeOptions {
  /** Throw this instead of succeeding. */
  fail?: Error;
  /** Fail this many times, then succeed — for retry tests. */
  failTimes?: number;
  /** Hang for this long, to trip the timeout. */
  hangMs?: number;
  /** Emit artifacts the declaration does not list — for isolation tests. */
  strayArtifact?: boolean;
  /** Produce nothing at all despite reporting success. */
  emitNothing?: boolean;
}

let calls: Record<string, number> = {};

function fakeAgent(id: AgentId, options: FakeOptions = {}): Agent {
  const definition = declared(id);

  return {
    definition,
    async execute(input: AgentExecutionInput): Promise<AgentResult> {
      calls[id] = (calls[id] ?? 0) + 1;

      if (options.hangMs) {
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, options.hangMs);
          input.signal.addEventListener('abort', () => {
            clearTimeout(timer);
            resolve(undefined);
          });
        });
      }

      const attempts = calls[id] ?? 0;
      if (options.fail && (options.failTimes === undefined || attempts <= options.failTimes)) {
        throw options.fail;
      }

      const artifacts: Record<string, unknown> = options.emitNothing
        ? {}
        : Object.fromEntries(definition.produces.map((type) => [type, { produced: id }]));
      if (options.strayArtifact) artifacts['frontend-source'] = { sneaky: true };

      return {
        agentId: id,
        status: 'succeeded',
        output: null,
        artifacts,
        findings: [],
        error: null,
        failureKind: null,
        durationMs: 1,
        usage: null,
      };
    },
  };
}

function input(overrides: Partial<AgentExecutionInput> = {}): AgentExecutionInput {
  return {
    projectId: 'p1',
    runId: 'r1',
    taskId: 't1',
    prompt: 'Build an e-commerce platform with orders and payments.',
    inputArtifacts: {},
    context: null,
    signal: new AbortController().signal,
    ...overrides,
  };
}

beforeEach(() => {
  resetRegistryForTests();
  calls = {};
});

/* ── Registry ─────────────────────────────────────────────────────────── */

describe('agent registry', () => {
  it('registers and retrieves an implementation', () => {
    registerAgent(fakeAgent('requirement-analyst'));
    assert.ok(hasAgent('requirement-analyst'));
    assert.equal(getAgent('requirement-analyst').definition.id, 'requirement-analyst');
  });

  it('refuses an implementation with no declaration', () => {
    const rogue = {
      definition: { ...declared('architecture-agent'), id: 'ghost' as AgentId },
      execute: async () => Promise.reject(new Error('never')),
    } as Agent;
    assert.throws(() => {
      registerAgent(rogue);
    }, /no declaration/i);
  });

  it('reports every declaration, implemented or not', () => {
    registerAgent(fakeAgent('requirement-analyst'));
    assert.ok(listDefinitions().length > 3, 'declarations exist beyond what is implemented');
    // Runnable means declared-enabled AND implemented — both halves matter.
    assert.deepEqual(
      runnableAgents().map((d) => d.id),
      ['requirement-analyst'],
    );
  });

  it('resolves transitive dependencies nearest-first', () => {
    assert.deepEqual(resolveDependencies('database-architect'), [
      'requirement-analyst',
      'product-architect',
      'architecture-agent',
    ]);
    assert.deepEqual(resolveDependencies('requirement-analyst'), []);
  });
});

/* ── Planning ─────────────────────────────────────────────────────────── */

describe('execution plan', () => {
  const plan = buildPlan({
    projectId: 'p1',
    runId: 'r1',
    agentIds: ['requirement-analyst', 'architecture-agent', 'database-architect'],
    priority: 'NORMAL',
  });

  const base = plan.tasks[0];
  assert.ok(base, 'the plan produced no tasks');

  it('creates one task per agent with its declared inputs', () => {
    assert.equal(plan.tasks.length, 3);
    const database = plan.tasks.find((task) => task.agentId === 'database-architect');
    assert.deepEqual(database?.inputArtifactTypes, ['architecture-plan', 'requirement-spec']);
  });

  it('wires dependency edges between tasks, not agents', () => {
    const analyst = plan.tasks.find((t) => t.agentId === 'requirement-analyst');
    const architect = plan.tasks.find((t) => t.agentId === 'architecture-agent');
    assert.ok(analyst && architect);
    assert.deepEqual(analyst.dependencyTaskIds, []);
    // The architecture agent depends on the product architect, which is not
    // in this three-agent subset — dependencies outside the requested set
    // are dropped, and the artifact-level check is what still guards it.
    assert.deepEqual(architect.dependencyTaskIds, []);
  });

  it('orders a full mesh into dependency waves', () => {
    const mesh = buildPlan({
      projectId: 'p1',
      runId: 'r1',
      agentIds: [
        'requirement-analyst',
        'product-architect',
        'architecture-agent',
        'database-architect',
        'api-architect',
      ],
      priority: 'NORMAL',
    });
    // Five agents, five waves: the API architect needs the database, so
    // the branch in the diagram is a chain in practice.
    assert.equal(mesh.waves.length, 5);
    assert.ok(mesh.waves.every((wave) => wave.length === 1));
  });

  it('groups independent tasks into the same wave', () => {
    // A DAG, not a chain: two agents with no dependency between them share
    // a wave even though the current three-agent plan is linear.
    const tasks: AgentTask[] = [
      { ...base, id: 'a', dependencyTaskIds: [] },
      { ...base, id: 'b', dependencyTaskIds: [] },
      { ...base, id: 'c', dependencyTaskIds: ['a', 'b'] },
    ];
    assert.deepEqual(computeWaves(tasks), [['a', 'b'], ['c']]);
  });

  it('detects a dependency cycle rather than looping', () => {
    const tasks: AgentTask[] = [
      { ...base, id: 'a', dependencyTaskIds: ['b'] },
      { ...base, id: 'b', dependencyTaskIds: ['a'] },
    ];
    assert.throws(() => computeWaves(tasks), /cyclic/i);
  });

  it('sorts by priority without reordering across dependencies', () => {
    const ordered = orderByPriority([
      { ...base, priority: 'LOW' },
      { ...base, priority: 'CRITICAL' },
      { ...base, priority: 'NORMAL' },
    ]);
    assert.deepEqual(
      ordered.map((t) => t.priority),
      ['CRITICAL', 'NORMAL', 'LOW'],
    );
  });
});

/* ── Readiness ────────────────────────────────────────────────────────── */

describe('dependency resolution', () => {
  function taskFor(run: AgentRun, agentId: AgentId): AgentTask {
    const task = run.tasks.find((entry) => entry.agentId === agentId);
    assert.ok(task, `no task for ${agentId}`);
    return task;
  }

  function runWith(statuses: Record<string, AgentTask['status']>): AgentRun {
    const plan = buildPlan({
      projectId: 'p1',
      runId: 'r1',
      agentIds: ['requirement-analyst', 'product-architect', 'architecture-agent'],
      priority: 'NORMAL',
    });
    for (const task of plan.tasks) {
      const status = statuses[task.agentId];
      if (status) task.status = status;
    }
    return {
      id: 'r1',
      projectId: 'p1',
      ownerId: 'o1',
      prompt: 'x',
      status: 'RUNNING',
      tasks: plan.tasks,
      currentTaskId: null,
      createdAt: '',
      updatedAt: '',
      error: null,
      totals: { aiCalls: 0, inputTokens: 0, outputTokens: 0, contextTokens: 0, costUsd: 0 },
    };
  }

  it('is READY when it needs nothing', () => {
    const run = runWith({});
    const analyst = taskFor(run, 'requirement-analyst');
    assert.equal(readiness(run, analyst, {}), 'READY');
  });

  it('is PENDING while its dependency is unfinished', () => {
    const run = runWith({ 'product-architect': 'RUNNING' });
    const architect = taskFor(run, 'architecture-agent');
    assert.equal(readiness(run, architect, {}), 'PENDING');
  });

  it('is BLOCKED when its dependency failed', () => {
    const run = runWith({ 'product-architect': 'FAILED' });
    const architect = taskFor(run, 'architecture-agent');
    assert.equal(readiness(run, architect, {}), 'BLOCKED');
  });

  it('is BLOCKED when nothing left in the plan can supply its inputs', () => {
    // The bug this pins: a task whose dependency is not in the plan at all
    // used to report PENDING forever, and the run settled as COMPLETED
    // having done nothing.
    const plan = buildPlan({
      projectId: 'p1',
      runId: 'r1',
      agentIds: ['architecture-agent'],
      priority: 'NORMAL',
    });
    const solo: AgentRun = {
      id: 'r1',
      projectId: 'p1',
      ownerId: 'o1',
      prompt: 'x',
      status: 'RUNNING',
      tasks: plan.tasks,
      currentTaskId: null,
      createdAt: '',
      updatedAt: '',
      error: null,
      totals: { aiCalls: 0, inputTokens: 0, outputTokens: 0, contextTokens: 0, costUsd: 0 },
    };
    const architect = taskFor(solo, 'architecture-agent');
    assert.deepEqual(architect.dependencyTaskIds, [], 'its dependency is outside this plan');
    assert.equal(readiness(solo, architect, {}), 'BLOCKED');
  });

  it('is BLOCKED when a dependency succeeded but produced no usable artifact', () => {
    // Upstream reported success and emitted nothing. Running anyway would
    // hand the agent absent input and blame it for the result.
    const run = runWith({ 'product-architect': 'COMPLETED' });
    const architect = taskFor(run, 'architecture-agent');
    assert.equal(readiness(run, architect, {}), 'BLOCKED');
  });

  it('is READY once every artifact it declared exists', () => {
    const run = runWith({ 'product-architect': 'COMPLETED' });
    const architect = taskFor(run, 'architecture-agent');
    // It declares both, so one is not enough.
    assert.equal(readiness(run, architect, { 'requirement-spec': {} }), 'BLOCKED');
    assert.equal(
      readiness(run, architect, { 'requirement-spec': {}, 'product-spec': {} }),
      'READY',
    );
  });
});

/* ── Execution: retries, timeouts, validation ─────────────────────────── */

describe('agent execution', () => {
  it('succeeds and returns the declared artifacts', async () => {
    registerAgent(fakeAgent('requirement-analyst'));
    const { result, attempts } = await executeAgent(declared('requirement-analyst'), input());
    assert.equal(result.status, 'succeeded');
    assert.equal(attempts, 1);
    assert.ok(result.artifacts['requirement-spec']);
  });

  it('retries a transient failure and succeeds', async () => {
    registerAgent(
      fakeAgent('requirement-analyst', {
        fail: new AgentError('network', 'connection reset'),
        failTimes: 1,
      }),
    );
    const { result, attempts } = await executeAgent(
      {
        ...declared('requirement-analyst'),
        retryPolicy: { maxRetries: 2, backoffMs: 1, retryableKinds: ['network'] },
      },
      input(),
    );
    assert.equal(result.status, 'succeeded');
    assert.equal(attempts, 2);
    assert.equal(calls['requirement-analyst'], 2);
  });

  it('stops after the retry budget and never loops', async () => {
    registerAgent(
      fakeAgent('requirement-analyst', { fail: new AgentError('network', 'still down') }),
    );
    const { result, attempts } = await executeAgent(
      {
        ...declared('requirement-analyst'),
        retryPolicy: { maxRetries: 2, backoffMs: 1, retryableKinds: ['network'] },
      },
      input(),
    );
    assert.equal(result.status, 'failed');
    assert.equal(attempts, 3, 'one attempt plus two retries, then stop');
    assert.equal(calls['requirement-analyst'], 3);
  });

  it('does not retry a deterministic failure', async () => {
    // Retrying invalid input just produces the same failure twice.
    registerAgent(
      fakeAgent('requirement-analyst', { fail: new AgentError('invalid-input', 'no prompt') }),
    );
    const { result, attempts } = await executeAgent(declared('requirement-analyst'), input());
    assert.equal(result.status, 'failed');
    assert.equal(result.failureKind, 'invalid-input');
    assert.equal(attempts, 1);
  });

  it('times out rather than hanging in RUNNING', async () => {
    registerAgent(fakeAgent('requirement-analyst', { hangMs: 5_000 }));
    const { result } = await executeAgent(
      {
        ...declared('requirement-analyst'),
        timeoutMs: 60,
        retryPolicy: { maxRetries: 0, backoffMs: 0, retryableKinds: [] },
      },
      input(),
    );
    assert.equal(result.status, 'failed');
    assert.equal(result.failureKind, 'timeout');
    assert.match(result.error ?? '', /time limit/i);
  });

  it('never leaks a raw error to the caller', async () => {
    registerAgent(
      fakeAgent('requirement-analyst', { fail: new Error('ECONNREFUSED 10.0.0.1:443 stack...') }),
    );
    const { result } = await executeAgent(declared('requirement-analyst'), input());
    assert.equal(result.status, 'failed');
    assert.ok(!result.error?.includes('10.0.0.1'), 'internals stay in the log');
  });

  it('stops immediately when the run is already cancelled', async () => {
    registerAgent(fakeAgent('requirement-analyst'));
    const controller = new AbortController();
    controller.abort();
    const { result } = await executeAgent(
      declared('requirement-analyst'),
      input({ signal: controller.signal }),
    );
    assert.equal(result.failureKind, 'cancelled');
    assert.equal(calls['requirement-analyst'], undefined, 'the agent never ran');
  });
});

/* ── Validation and isolation ─────────────────────────────────────────── */

describe('output validation', () => {
  const definition = declared('database-architect');

  it('rejects a success that produced nothing', () => {
    const result = validateResult(definition, {
      agentId: 'database-architect',
      status: 'succeeded',
      output: null,
      artifacts: {},
      findings: [],
      error: null,
      failureKind: null,
      durationMs: 1,
      usage: null,
    });
    assert.equal(result.valid, false);
    assert.match(result.reason ?? '', /returned none/i);
  });

  it('rejects artifacts outside the agent’s declared scope', () => {
    // The isolation boundary: a database agent must not write frontend source.
    const result = validateResult(definition, {
      agentId: 'database-architect',
      status: 'succeeded',
      output: null,
      artifacts: { 'database-design': {}, 'frontend-source': {} },
      findings: [],
      error: null,
      failureKind: null,
      durationMs: 1,
      usage: null,
    });
    assert.equal(result.valid, false);
    assert.match(result.reason ?? '', /outside its declared scope/i);
  });

  it('accepts exactly what was declared', () => {
    const result = validateResult(definition, {
      agentId: 'database-architect',
      status: 'succeeded',
      output: null,
      artifacts: { 'database-design': {} },
      findings: [],
      error: null,
      failureKind: null,
      durationMs: 1,
      usage: null,
    });
    assert.equal(result.valid, true);
  });

  it('rejects the API contract from the database architect — it has a new owner', () => {
    // It moved to the API Architect in the planning mesh. One artifact, one
    // author, so a regenerated contract has a single provenance chain.
    const result = validateResult(definition, {
      agentId: 'database-architect',
      status: 'succeeded',
      output: null,
      artifacts: { 'database-design': {}, 'api-contract': {} },
      findings: [],
      error: null,
      failureKind: null,
      durationMs: 1,
      usage: null,
    });
    assert.equal(result.valid, false);
  });

  it('fails an agent whose stray artifact would enter project state', async () => {
    registerAgent(fakeAgent('database-architect', { strayArtifact: true }));
    const { result } = await executeAgent(definition, input());
    assert.equal(result.status, 'failed');
    assert.equal(result.failureKind, 'invalid-output');
  });

  it('fails an agent that reports success but emits nothing', async () => {
    registerAgent(fakeAgent('database-architect', { emitNothing: true }));
    const { result } = await executeAgent(definition, input());
    assert.equal(result.status, 'failed');
  });
});

/* ── Failure classification ───────────────────────────────────────────── */

describe('failure classification', () => {
  it('recognises the kinds a retry can fix', () => {
    assert.equal(classify(new AgentError('rate-limit', 'x')), 'rate-limit');
    assert.equal(classify(new Error('Request timed out after 60000ms')), 'timeout');
    assert.equal(classify(new Error('fetch failed')), 'network');
    assert.equal(classify(new Error('responded 429 rate limited')), 'rate-limit');
  });

  it('recognises the kinds a retry cannot', () => {
    assert.equal(classify(new Error('responded 401: Invalid API Key')), 'unauthorized');
    assert.equal(classify(new Error('Response is not valid JSON')), 'invalid-output');
  });

  it('treats an unrecognised failure as non-retryable', () => {
    // Guessing that an unknown error is transient turns one bug into three
    // identical model calls.
    assert.equal(classify(new Error('something odd happened')), 'internal');
    const policy = declared('requirement-analyst').retryPolicy;
    assert.ok(!policy.retryableKinds.includes('internal'));
  });
});
