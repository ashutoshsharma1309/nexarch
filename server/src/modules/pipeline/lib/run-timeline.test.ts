import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  listExecutionEvents,
  listStageUsage,
  useExecutionStore,
} from '../../execution-events/execution-events.service.js';
import { createMemoryStore } from '../../execution-events/lib/event-store.js';
import { RunEvents } from './run-events.js';
import { adoptBilledUsage, replayStages } from './run-rehydration.js';
import type {
  ExecutionEvent,
  StageUsageRecord,
} from '../../execution-events/execution-events.types.js';
import type { PipelineRun, PipelineStage } from '../pipeline.types.js';
import type { AiCallStat } from './ai-stages.js';

function stage(id: string, overrides: Partial<PipelineStage> = {}): PipelineStage {
  return {
    id,
    label: id,
    status: 'pending',
    engine: 'deterministic',
    agentId: 'database-architect',
    responsibility: 'Design tables.',
    startedAt: null,
    completedAt: null,
    durationMs: 5,
    summary: 'done',
    error: null,
    degraded: false,
    ...overrides,
  } as PipelineStage;
}

const run = (projectId: string | null): PipelineRun =>
  ({ id: 'job-1', projectId, projectName: 'P', stages: [] }) as unknown as PipelineRun;

const stat: AiCallStat = {
  provider: 'groq',
  model: 'm',
  inputTokens: 10,
  outputTokens: 20,
  costUsd: 0,
  knownCostUsd: null,
  durationMs: 9,
  attempt: 1,
  cacheHit: false,
};

async function eventsOf(): Promise<ExecutionEvent[]> {
  await new Promise((resolve) => setTimeout(resolve, 20));
  return listExecutionEvents('job-1');
}

describe('run events', () => {
  beforeEach(() => {
    useExecutionStore(createMemoryStore());
  });
  afterEach(() => {
    useExecutionStore();
  });

  it('publishes nothing for a run with no project', async () => {
    const events = new RunEvents(run(null));
    events.jobStarted();
    events.stageStarted(stage('database'));
    assert.deepEqual(await eventsOf(), []);
  });

  it('names the agent, its task and the engine that really did the work', async () => {
    new RunEvents(run('p')).stageStarted(stage('database'));
    const agent = (await eventsOf()).find((event) => event.type === 'agent.started');
    assert.equal(agent?.agentId, 'database-architect');
    assert.equal(agent.data?.task, 'Design tables.');
    assert.equal(agent.data.engine, 'deterministic');
    assert.match(agent.message, /deterministic code/);
  });

  it('keeps tokens out of event data and leaves the usage row to the call itself', async () => {
    new RunEvents(run('p')).modelCall(stage('frontend'), stat);
    const call = (await eventsOf()).find((event) => event.type === 'model.call');
    assert.ok(call);
    assert.ok(!Object.keys(call.data ?? {}).some((key) => /token/i.test(key)));
    // generate() already wrote this call's row; a second would double the bill.
    assert.deepEqual(await listStageUsage('job-1'), []);
  });

  it('does not call a cached answer a model call', async () => {
    new RunEvents(run('p')).modelCall(stage('frontend'), { ...stat, cacheHit: true });
    const all = await eventsOf();
    assert.ok(!all.some((event) => event.type === 'model.call'));
    assert.deepEqual(await listStageUsage('job-1'), []);
  });

  it('records timing alone for a stage with no model call', async () => {
    new RunEvents(run('p')).stageCompleted(stage('database'), false);
    await eventsOf();
    const [usage] = await listStageUsage('job-1');
    assert.equal(usage?.provider, null);
    assert.equal(usage.inputTokens, null);
    assert.equal(usage.durationMs, 5);
  });
});

describe('replaying a run from its events', () => {
  const event = (type: string, name: string, data: Record<string, unknown>): ExecutionEvent =>
    ({
      type,
      stage: name,
      data,
      createdAt: '2026-11-09T00:00:00.000Z',
    }) as unknown as ExecutionEvent;

  it('rebuilds what each stage reported', () => {
    const stages = [stage('analysis', { summary: null }), stage('database', { summary: null })];
    replayStages(
      stages,
      [
        event('stage.started', 'analysis', {}),
        event('stage.completed', 'analysis', {
          durationMs: 7,
          summary: '3 modules',
          degraded: true,
        }),
        event('stage.skipped', 'database', { reason: 'Not needed' }),
      ],
      true,
    );
    assert.equal(stages[0]?.status, 'completed');
    assert.equal(stages[0].summary, '3 modules');
    assert.equal(stages[0].degraded, true);
    assert.equal(stages[1]?.status, 'skipped');
    assert.equal(stages[1].summary, 'Not needed');
  });

  it('never leaves a dead stage looking alive', () => {
    const stages = [stage('analysis', { summary: null }), stage('database', { summary: null })];
    replayStages(stages, [event('stage.started', 'analysis', {})], false);
    assert.equal(stages[0]?.status, 'failed');
    assert.match(stages[0].error ?? '', /no longer running/);
    assert.equal(stages[1]?.status, 'skipped');
  });
});

describe('adopting billed usage', () => {
  const totals = () =>
    ({
      calls: 2,
      provider: 'groq',
      model: 'm',
      inputTokens: 100,
      outputTokens: 50,
      estimatedCostUsd: 0.01,
    }) as PipelineRun['ai'];
  const row = (inputTokens: number, outputTokens: number, costUsd: number) =>
    ({ provider: 'groq', inputTokens, outputTokens, costUsd }) as unknown as StageUsageRecord;

  it('takes the rows when they saw spend the run could not', () => {
    const ai = totals();
    adoptBilledUsage(ai, [row(100, 50, 0.01), row(80, 20, 0.02), row(5, 5, 0)]);
    assert.equal(ai.inputTokens, 185);
    assert.equal(ai.outputTokens, 75);
    assert.equal(ai.calls, 3);
    assert.equal(ai.estimatedCostUsd, 0.03);
  });

  it('keeps real totals when the rows are absent or behind', () => {
    const ai = totals();
    adoptBilledUsage(ai, []);
    adoptBilledUsage(ai, [row(10, 10, 0)]);
    assert.deepEqual(ai, totals());
  });
});
