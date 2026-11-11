/**
 * Conditional selection, the new DAG edges and completion criteria.
 *
 * No model and no network: under `NODE_ENV=test` routes pin to the mock and
 * research has no fetch, so what these see is the honest no-provider path.
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { SITE_DESIGN_ARTIFACT } from '../../shared/contracts/agent-registry.js';
import { currentLogContext } from '../../shared/logger/context.js';
import type { LogContext } from '../../shared/logger/context.js';
import { designIntelligenceAgent } from './agents/design-intelligence.agent.js';
import { referenceUrlsIn, researchAgent } from './agents/research-agent.agent.js';
import { applyAgentSelection, decideSkips } from './lib/agent-selection.js';
import { sumUsage, toAgentUsage } from './lib/agent-usage.js';
import { evaluateCompletion } from './lib/completion-criteria.js';
import { resetExecutionPublisherForTests } from './lib/execution-publisher.js';
import { buildPlan, computeWaves } from './lib/planner.js';
import { createRun, resetStoreForTests } from './lib/run-store.js';
import { readiness, runPlan } from './lib/scheduler.js';
import { registerAgent, resetRegistryForTests } from './lib/registry.js';
import {
  listExecutionEvents,
  listStageUsage,
  publishExecutionEvent,
  useExecutionStore,
} from '../execution-events/execution-events.service.js';
import { createMemoryStore } from '../execution-events/lib/event-store.js';
import { getAgentDefinition } from '../../shared/contracts/index.js';
import type {
  Agent,
  AgentExecutionInput,
  AgentId,
  AgentUsage,
  ArtifactType,
} from '../../shared/contracts/index.js';
import type { RequirementSpec } from '../../shared/types/requirement.js';
import type { AgentRun } from './agent-orchestrator.types.js';

const APP_PROMPT = 'Build a platform where clinics manage appointments and patient records';
const WEBSITE_PROMPT = 'A brochure website for a small pottery studio';

const FULL_MESH: AgentId[] = [
  'requirement-analyst',
  'research-agent',
  'product-architect',
  'design-intelligence',
  'backend-engineer',
  'frontend-engineer',
  'ux-ui-engineer',
  'security-engineer',
  'integration-engineer',
  'test-engineer',
];

const SPEC: RequirementSpec = {
  projectName: 'Pottery Studio',
  projectType: 'website',
  roles: ['Visitor'],
  modules: ['Classes'],
  frontend: ['Home'],
  backend: [],
  database: [],
  authentication: [],
  integrations: [],
  missingRequirements: [],
};

function runFor(prompt: string, agentIds = FULL_MESH, explicit = false): AgentRun {
  const plan = buildPlan({ projectId: 'p1', runId: 'r1', agentIds, priority: 'NORMAL' });
  const now = new Date().toISOString();
  const run: AgentRun = {
    id: 'r1',
    projectId: 'p1',
    ownerId: 'o1',
    prompt,
    status: 'PENDING',
    ...(explicit ? { explicitAgents: true } : {}),
    tasks: plan.tasks,
    currentTaskId: null,
    createdAt: now,
    updatedAt: now,
    error: null,
    totals: { aiCalls: 0, inputTokens: 0, outputTokens: 0, contextTokens: 0, costUsd: 0 },
  };
  createRun(run, new AbortController());
  return run;
}

function statusOf(run: AgentRun, agentId: AgentId): string | undefined {
  return run.tasks.find((task) => task.agentId === agentId)?.status;
}

function inputFor(prompt: string): AgentExecutionInput {
  return {
    projectId: 'p1',
    runId: 'r1',
    taskId: 't1',
    prompt,
    inputArtifacts: { 'requirement-spec': SPEC },
    context: null,
    signal: new AbortController().signal,
  };
}

beforeEach(() => {
  resetStoreForTests();
  resetExecutionPublisherForTests();
});

describe('agent selection', () => {
  it('runs every agent when the product needs an application', () => {
    assert.deepEqual(decideSkips(APP_PROMPT), []);
  });

  it('skips API and data-flow checks for a website with nothing behind it', () => {
    const skipped = decideSkips(WEBSITE_PROMPT).map((skip) => skip.agentId);
    assert.deepEqual(skipped.sort(), ['integration-engineer', 'test-engineer']);
  });

  it('honours an explicit request not to research', () => {
    const skipped = decideSkips(`${APP_PROMPT}. No research please.`).map((s) => s.agentId);
    assert.deepEqual(skipped, ['research-agent']);
  });

  it('skips the site design for an API with no interface', () => {
    const skipped = decideSkips(`An API-only ${APP_PROMPT}`).map((s) => s.agentId);
    assert.deepEqual(skipped, ['design-intelligence']);
  });

  it('records the reason on the task and never marks it complete', () => {
    const run = runFor(WEBSITE_PROMPT);
    const applied = applyAgentSelection(run);
    assert.equal(applied.length, 2);
    const task = run.tasks.find((entry) => entry.agentId === 'integration-engineer');
    assert.equal(task?.status, 'SKIPPED');
    assert.match(task.skipReason ?? '', /website/);
    assert.equal(task.completedAt, null);
  });

  it('leaves work that already ran alone', () => {
    const run = runFor(WEBSITE_PROMPT);
    const task = run.tasks.find((entry) => entry.agentId === 'integration-engineer');
    assert.ok(task);
    task.status = 'COMPLETED';
    applyAgentSelection(run);
    assert.equal(statusOf(run, 'integration-engineer'), 'COMPLETED');
    assert.equal(statusOf(run, 'test-engineer'), 'SKIPPED');
  });

  it('does not remove agents a caller named', () => {
    const run = runFor(WEBSITE_PROMPT, FULL_MESH, true);
    assert.deepEqual(applyAgentSelection(run), []);
    assert.notEqual(statusOf(run, 'integration-engineer'), 'SKIPPED');
  });
});

describe('readiness around a skipped agent', () => {
  it('treats a skipped dependency as settled', () => {
    const run = runFor(APP_PROMPT, ['requirement-analyst', 'research-agent', 'product-architect']);
    const task = (id: AgentId) => run.tasks.find((entry) => entry.agentId === id);
    const analyst = task('requirement-analyst');
    const research = task('research-agent');
    const architect = task('product-architect');
    assert.ok(analyst && research && architect);
    analyst.status = 'COMPLETED';
    research.status = 'SKIPPED';
    assert.equal(readiness(run, architect, { 'requirement-spec': SPEC }), 'READY');
  });

  it('still blocks when a declared input never arrived', () => {
    const run = runFor(APP_PROMPT, ['research-agent', 'product-architect']);
    const research = run.tasks.find((entry) => entry.agentId === 'research-agent');
    const architect = run.tasks.find((entry) => entry.agentId === 'product-architect');
    assert.ok(research && architect);
    research.status = 'SKIPPED';
    assert.equal(readiness(run, architect, {}), 'BLOCKED');
  });
});

describe('mesh order', () => {
  const plan = buildPlan({ projectId: 'p1', runId: 'r1', agentIds: FULL_MESH, priority: 'NORMAL' });
  const waves = computeWaves(plan.tasks);
  const agentOf = new Map(plan.tasks.map((task) => [task.id, task.agentId]));
  const waveOf = (agentId: AgentId): number =>
    waves.findIndex((wave) => wave.some((id) => agentOf.get(id) === agentId));

  it('researches between analysis and product architecture', () => {
    assert.ok(waveOf('research-agent') > waveOf('requirement-analyst'));
    assert.ok(waveOf('product-architect') > waveOf('research-agent'));
  });

  it('designs before the frontend is generated', () => {
    assert.ok(waveOf('frontend-engineer') > waveOf('design-intelligence'));
  });

  it('reviews only after the UX engineer has finished rewriting', () => {
    assert.ok(waveOf('security-engineer') > waveOf('ux-ui-engineer'));
  });
});

describe('the new agents', () => {
  it('finds reference URLs without trailing punctuation', () => {
    assert.deepEqual(referenceUrlsIn('Like https://example.com/a, or (https://example.org).'), [
      'https://example.com/a',
      'https://example.org',
    ]);
  });

  it('reports research it could not do as unavailable, with no invented sources', async () => {
    const result = await researchAgent.execute(inputFor(APP_PROMPT));
    assert.equal(result.status, 'succeeded');
    const artifact = result.artifacts['research-artifact'] as {
      status: string;
      sources: unknown[];
      limitations: string[];
    };
    assert.equal(artifact.status, 'unavailable');
    assert.deepEqual(artifact.sources, []);
    assert.ok(artifact.limitations.length > 0);
    assert.equal(result.findings[0]?.category, 'RESEARCH');
    assert.equal(result.usage, null);
  });

  // Whether the model path or the fallback runs depends on which keys this
  // machine has, so the test holds the two facts that must agree either way.
  it('writes a design and says whether it fell back to the spec', async () => {
    const result = await designIntelligenceAgent.execute(inputFor(WEBSITE_PROMPT));
    assert.equal(result.status, 'succeeded');
    assert.deepEqual(evaluateCompletion('design-intelligence', result.artifacts).unmet, []);
    const artifact = result.artifacts[SITE_DESIGN_ARTIFACT] as { degraded: boolean };
    assert.equal(
      result.findings.some((finding) => finding.category === 'RELIABILITY'),
      artifact.degraded,
    );
  });
});

describe('completion criteria', () => {
  it('measures what was returned', () => {
    assert.deepEqual(
      evaluateCompletion('database-architect', { 'database-design': { tables: [] } }),
      {
        met: [],
        unmet: ['tables-designed'],
      },
    );
    assert.deepEqual(
      evaluateCompletion('database-architect', { 'database-design': { tables: [{}] } }).met,
      ['tables-designed'],
    );
  });

  it('requires research short of complete to say why', () => {
    const unmet = evaluateCompletion('research-agent', {
      'research-artifact': { status: 'partial', limitations: [] },
    }).unmet;
    assert.deepEqual(unmet, ['limits-explained']);
  });
});

describe('usage', () => {
  const call = { provider: 'groq', model: 'm', inputTokens: 10, outputTokens: 5, costUsd: 0.1 };

  it('keeps no call as null rather than zero', () => {
    assert.equal(toAgentUsage(null), null);
    assert.equal(sumUsage([null, null]), null);
  });

  it('adds every call that was really made', () => {
    const total = sumUsage([toAgentUsage(call), null, toAgentUsage(call)]);
    assert.equal(total?.inputTokens, 20);
    assert.equal(total.outputTokens, 10);
    assert.equal(total.costUsd, 0.2);
  });
});

describe('a run through the scheduler', () => {
  const contexts = new Map<string, LogContext>();

  function fake(
    id: AgentId,
    type: ArtifactType,
    content: unknown,
    usage: AgentUsage | null,
  ): Agent {
    const definition = getAgentDefinition(id);
    assert.ok(definition);
    return {
      definition,
      execute: () => {
        contexts.set(id, { ...currentLogContext() });
        return Promise.resolve({
          agentId: id,
          status: 'succeeded',
          output: content,
          artifacts: { [type]: content },
          findings: [],
          error: null,
          failureKind: null,
          durationMs: 1,
          usage,
        });
      },
    };
  }

  const USAGE: AgentUsage = {
    provider: 'groq',
    model: 'm',
    inputTokens: 12,
    outputTokens: 3,
    costUsd: 0,
    contextTokens: 0,
  };

  beforeEach(() => {
    resetRegistryForTests();
    useExecutionStore(createMemoryStore());
    registerAgent(fake('requirement-analyst', 'requirement-spec', SPEC, null));
    registerAgent(fake('product-architect', 'product-spec', { modules: [{}], screens: [] }, USAGE));
  });

  it('skips by decision, finishes, and publishes what really happened', async () => {
    const run = runFor(`${APP_PROMPT}. No research.`, [
      'requirement-analyst',
      'research-agent',
      'product-architect',
    ]);
    await runPlan(run, run.prompt);

    assert.equal(run.status, 'COMPLETED');
    assert.equal(statusOf(run, 'research-agent'), 'SKIPPED');
    assert.equal(statusOf(run, 'product-architect'), 'COMPLETED');

    const architect = run.tasks.find((task) => task.agentId === 'product-architect');
    assert.deepEqual(architect?.completion, {
      met: ['modules-defined'],
      unmet: ['screens-defined'],
    });

    // Publishes are queued per job; awaiting one more drains what came before.
    await publishExecutionEvent({
      projectId: 'p1',
      jobKind: 'RUN',
      jobId: 'r1',
      type: 'note',
      message: 'flush',
    });
    const types = (await listExecutionEvents('r1')).map((event) => event.type);
    assert.equal(types.filter((type) => type === 'job.started').length, 1);
    assert.equal(types.filter((type) => type === 'job.completed').length, 1);
    assert.ok(types.includes('stage.skipped'));
    assert.equal(types.filter((type) => type === 'agent.completed').length, 2);

    // A model call writes its own row from this context, so the agent's
    // summary must not add a second one for the same tokens.
    assert.deepEqual(await listStageUsage('r1'), []);
    assert.equal(contexts.get('product-architect')?.agentId, 'product-architect');
    assert.ok(contexts.get('product-architect')?.stage);
  });
});
