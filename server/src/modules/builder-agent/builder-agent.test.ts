/**
 * Builder Agent tests (`npm test`): the loop's decisions, not the systems it
 * drives. Tools are fakes that change session state the way the real ones do,
 * so every path — policy, model, refusal, failure, cancellation — is exact
 * and fast. The real tools are exercised end to end against the running app.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { z } from 'zod';

import type { BuilderSession, BuilderToolName } from './builder-agent.types.js';
import type { DecideOutcome } from './lib/decider.js';
import { runLoop } from './lib/loop.js';
import { projectNameFor } from './lib/policy.js';
import type { PlannedAction } from './lib/policy.js';
import { landingSectionsOf, markBuilt, runTool } from './lib/tools.js';
import type { BuilderTool, ToolResult } from './lib/tools.js';

function newSession(task = 'Build a landing page for a company called NovaStack.'): BuilderSession {
  const at = new Date().toISOString();
  return {
    id: 'session-1',
    task,
    status: 'running',
    plan: [],
    steps: [],
    state: {
      projectId: null,
      projectName: null,
      pipelineRunId: null,
      agentRunId: null,
      previewSessionId: null,
      frontendUrl: null,
      backendUrl: null,
      validationGate: null,
      repaired: false,
      inspected: false,
      buildDegraded: null,
      landingSections: [],
    },
    result: null,
    error: null,
    usage: {
      decisions: 0,
      modelDecisions: 0,
      policyDecisions: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    },
    createdAt: at,
    updatedAt: at,
  };
}

interface Fakes {
  calls: { tool: BuilderToolName; start: number; end: number }[];
  previewFails?: boolean;
}

function fakeTools(fakes: Fakes): (name: string) => BuilderTool | undefined {
  const tool = (
    name: BuilderToolName,
    effect: (session: BuilderSession) => ToolResult,
    delayMs = 5,
  ): BuilderTool => ({
    name,
    description: name,
    args: z.object({}).passthrough(),
    run: async (ctx) => {
      const start = Date.now();
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      const result = effect(ctx.session);
      fakes.calls.push({ tool: name, start, end: Date.now() });
      return result;
    },
  });

  const tools: BuilderTool[] = [
    tool('create_project', (s) => {
      s.state.projectId = 'p1';
      s.state.projectName = 'NovaStack';
      return { ok: true, summary: 'created' };
    }),
    tool('build_app', (s) => {
      s.state.pipelineRunId = 'run-1';
      s.state.landingSections = ['hero', 'features', 'pricing'];
      return { ok: true, summary: 'built' };
    }),
    tool(
      'preview_app',
      (s) => {
        s.state.previewSessionId = 'preview-1';
        if (fakes.previewFails) return { ok: false, summary: 'Preview failed: install error' };
        s.state.frontendUrl = 'http://localhost:5174';
        s.state.backendUrl = 'http://localhost:4001';
        return { ok: true, summary: 'running' };
      },
      40,
    ),
    tool(
      'review_app',
      (s) => {
        s.state.agentRunId = 'agents-1';
        s.state.validationGate = 'PASSED_WITH_WARNINGS';
        return { ok: true, summary: 'reviewed' };
      },
      40,
    ),
    tool('inspect_website', (s) => {
      s.state.inspected = true;
      return { ok: true, summary: '5/5 checks passed' };
    }),
    tool('finish', () => ({ ok: true, summary: 'Finished.' })),
  ];
  return (name) => tools.find((t) => t.name === name);
}

function deps(fakes: Fakes, decide: Parameters<typeof runLoop>[1]['decide'] = null) {
  return {
    decide,
    tool: fakeTools(fakes),
    runTool,
    ownerId: 'local-user',
    isCancelled: () => false,
  };
}

const toolSteps = (session: BuilderSession) =>
  session.steps.filter((step) => step.kind === 'tool').map((step) => step.tool);

describe('builder agent loop', () => {
  it('carries a task to an inspected, running website with the policy alone', async () => {
    const fakes: Fakes = { calls: [] };
    const session = newSession();
    await runLoop(session, deps(fakes));

    assert.equal(session.status, 'succeeded');
    assert.equal(session.result?.complete, true);
    assert.deepEqual(toolSteps(session), [
      'create_project',
      'build_app',
      'preview_app',
      'review_app',
      'inspect_website',
    ]);
    assert.equal(session.usage.modelDecisions, 0);
    assert.ok(session.plan.length > 0, 'the first decision publishes a plan');
    assert.match(session.result.summary, /running at http:\/\/localhost:5174/);
  });

  it('runs independent actions in parallel', async () => {
    const fakes: Fakes = { calls: [] };
    await runLoop(newSession(), deps(fakes));
    const preview = fakes.calls.find((call) => call.tool === 'preview_app');
    const review = fakes.calls.find((call) => call.tool === 'review_app');
    assert.ok(preview && review);
    assert.ok(preview.start < review.end && review.start < preview.end, 'the two overlapped');
  });

  it("uses the model's decisions and falls back when an answer is unusable", async () => {
    const fakes: Fakes = { calls: [] };
    let calls = 0;
    const decide = (session: BuilderSession): Promise<DecideOutcome> => {
      calls += 1;
      if (calls === 2) return Promise.resolve({ decision: null, error: 'bad JSON', usage: null });
      const first = session.steps.length === 0;
      return Promise.resolve({
        decision: {
          thought: 'model',
          plan: first ? ['a', 'b'] : [],
          actions: first
            ? [{ tool: 'create_project', args: { name: 'NovaStack' } }]
            : [{ tool: 'finish', args: {} }],
          summary: '',
        },
        error: null,
        usage: { inputTokens: 100, outputTokens: 20, costUsd: 0.001 },
      });
    };
    const session = newSession();
    await runLoop(session, deps(fakes, decide));

    assert.equal(session.steps[0]?.by, 'model');
    assert.deepEqual(session.plan, ['a', 'b']);
    assert.ok(
      session.steps.some((step) => step.kind === 'note' && step.summary.includes('bad JSON')),
      'the unusable answer is recorded',
    );
    assert.ok(session.usage.modelDecisions >= 1);
    assert.ok(session.usage.policyDecisions >= 1);
    assert.ok(session.usage.inputTokens >= 100);
  });

  it('refuses a premature finish and completes the work', async () => {
    const fakes: Fakes = { calls: [] };
    const decide = (): Promise<DecideOutcome> =>
      Promise.resolve({
        decision: {
          thought: 'done!',
          plan: [],
          actions: [{ tool: 'finish', args: {} }],
          summary: 'All built.',
        },
        error: null,
        usage: null,
      });
    const session = newSession();
    await runLoop(session, deps(fakes, decide));

    assert.ok(session.steps.some((step) => step.summary.startsWith('Finish refused')));
    // Refused once; the model insisted, so the session ends — honestly incomplete.
    assert.equal(session.status, 'failed');
    assert.equal(session.result?.complete, false);
    assert.doesNotMatch(session.result.summary, /^Built "/);
  });

  it('reports an honest failure when the preview cannot start', async () => {
    const fakes: Fakes = { calls: [], previewFails: true };
    const session = newSession();
    await runLoop(session, deps(fakes));

    assert.equal(session.status, 'failed');
    assert.equal(session.result?.complete, false);
    assert.equal(
      fakes.calls.filter((call) => call.tool === 'preview_app').length,
      2,
      'retried once',
    );
    assert.match(session.result.summary, /not completed/);
  });

  it('orders dependent actions a decision grouped together (seen in a real run)', async () => {
    const fakes: Fakes = { calls: [] };
    let turn = 0;
    const decide = (): Promise<DecideOutcome> => {
      turn += 1;
      // Turn 2 is what the model actually sent: build, preview and review at once.
      const byTurn: PlannedAction[][] = [
        [{ tool: 'create_project', args: { name: 'NovaStack' } }],
        [
          { tool: 'build_app', args: { prompt: 'x'.repeat(20) } },
          { tool: 'preview_app', args: {} },
          { tool: 'review_app', args: {} },
        ],
        [{ tool: 'inspect_website', args: {} }],
      ];
      const actions = byTurn[turn - 1] ?? [{ tool: 'finish', args: {} }];
      return Promise.resolve({
        decision: { thought: '', plan: [], actions, summary: '' },
        error: null,
        usage: null,
      });
    };
    const session = newSession();
    await runLoop(session, deps(fakes, decide));

    const build = fakes.calls.find((call) => call.tool === 'build_app');
    const preview = fakes.calls.find((call) => call.tool === 'preview_app');
    const review = fakes.calls.find((call) => call.tool === 'review_app');
    assert.ok(build && preview && review);
    assert.ok(build.end <= preview.start, 'preview waited for the build');
    assert.ok(build.end <= review.start, 'review waited for the build');
    assert.ok(
      preview.start < review.end && review.start < preview.end,
      'preview and review overlapped',
    );
    assert.equal(session.status, 'succeeded');
  });

  it('stops when cancelled', async () => {
    const fakes: Fakes = { calls: [] };
    const session = newSession();
    let turns = 0;
    await runLoop(session, {
      ...deps(fakes),
      isCancelled: () => {
        turns += 1;
        return turns > 2;
      },
    });
    assert.equal(session.status, 'cancelled');
  });

  it('rejects invalid tool arguments without running the tool', async () => {
    const tool: BuilderTool = {
      name: 'read_file',
      description: '',
      args: z.object({ path: z.string().min(1) }),
      run: () => Promise.reject(new Error('should not run')),
    };
    const result = await runTool(
      tool,
      { ownerId: 'x', session: newSession(), isCancelled: () => false },
      { path: 42 },
    );
    assert.equal(result.ok, false);
    assert.match(result.summary, /Invalid arguments/);
  });
});

describe('builder agent build/preview consistency', () => {
  it('a new build invalidates the preview and inspection (seen in a real run)', () => {
    const session = newSession();
    session.state.frontendUrl = 'http://localhost:5174';
    session.state.backendUrl = 'http://localhost:4001';
    session.state.inspected = true;
    markBuilt(session.state, false);
    assert.equal(session.state.frontendUrl, null);
    assert.equal(session.state.inspected, false);
    assert.equal(session.state.buildDegraded, false);
  });
});

describe('builder agent helpers', () => {
  it('takes the project name from the task when it names one', () => {
    assert.equal(
      projectNameFor(
        'Build a landing page for a fictional company called NovaStack. Include pricing.',
      ),
      'NovaStack',
    );
    assert.ok(projectNameFor('Build a todo app with tags').length > 0);
  });

  it('reads landing sections from the content module, JSON or dev-server JavaScript', () => {
    const json = `export const site: SiteContent = ${JSON.stringify({
      features: [{ title: 'a' }],
      pricing: [{ name: 'Pro' }],
      testimonials: [],
      faq: [{ question: 'q' }],
    })};\n`;
    assert.deepEqual(landingSectionsOf(json), ['hero', 'features', 'pricing', 'faq']);

    const transformed =
      'export const site = {\n  features: [{ title: `a` }],\n  pricing: [],\n  testimonials: [{ quote: "x" }],\n  faq: []\n};\n//# sourceMappingURL=data:x';
    assert.deepEqual(landingSectionsOf(transformed), ['hero', 'features', 'testimonials']);
  });
});
