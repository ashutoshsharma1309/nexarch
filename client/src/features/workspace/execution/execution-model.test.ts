import { describe, expect, it } from 'vitest';

import { buildExecutionView, totalUsage } from './execution-model';
import type { BuildViewInput, PlannedStage } from './execution-model';
import type {
  ExecutionEvent,
  ExecutionJobSummary,
  StageUsageRecord,
} from '@/shared/types/execution';

let seq = 0;
function event(type: string, overrides: Partial<ExecutionEvent> = {}): ExecutionEvent {
  seq += 1;
  return {
    id: `e${String(seq)}`,
    projectId: 'p1',
    jobKind: 'RUN',
    jobId: 'j1',
    seq,
    type,
    status: 'info',
    stage: null,
    agentId: null,
    message: type,
    data: null,
    createdAt: `2026-11-09T12:00:${String(seq).padStart(2, '0')}.000Z`,
    ...overrides,
  };
}

function summary(status: ExecutionJobSummary['status']): ExecutionJobSummary {
  return {
    jobId: 'j1',
    jobKind: 'RUN',
    status,
    title: null,
    createdAt: '2026-11-09T12:00:00.000Z',
    eventCount: 1,
    lastSeq: 1,
    lastEventAt: null,
  };
}

function usage(overrides: Partial<StageUsageRecord>): StageUsageRecord {
  return {
    id: 'u',
    projectId: 'p1',
    jobId: 'j1',
    stage: 'frontend',
    agentId: null,
    provider: 'groq',
    model: 'm',
    inputTokens: 10,
    outputTokens: 5,
    costUsd: 0.5,
    durationMs: 100,
    createdAt: '2026-11-09T12:00:00.000Z',
    ...overrides,
  };
}

function build(input: Partial<BuildViewInput>) {
  return buildExecutionView({
    jobKind: 'RUN',
    events: [],
    usage: [],
    summary: summary('running'),
    plan: [],
    feedEnded: false,
    ...input,
  });
}

const open = (stage: string) => event('stage.started', { stage, agentId: `${stage}-agent` });

describe('buildExecutionView', () => {
  it.each([
    ['research', 'researching'],
    ['architecture', 'planning'],
    ['frontend', 'implementing'],
    ['verification', 'testing'],
    ['repair', 'repairing'],
  ])('reports stage %s as %s while it is open', (stage, status) => {
    expect(build({ events: [open(stage)] }).status).toBe(status);
  });

  it('takes the working status from enhancement stages too', () => {
    const view = build({ jobKind: 'ENHANCEMENT', events: [open('implementing')] });
    expect(view.status).toBe('implementing');
    expect(view.currentStage?.id).toBe('implementing');
  });

  it.each([
    ['job.completed', 'completed'],
    ['job.failed', 'failed'],
    ['job.cancelled', 'cancelled'],
    ['job.interrupted', 'interrupted'],
  ])('%s ends the job as %s', (type, status) => {
    const view = build({ events: [event('job.started'), event(type)] });
    expect(view.status).toBe(status);
    expect(view.isActive).toBe(false);
  });

  it('never leaves a stage running once the job is over', () => {
    const view = build({ events: [open('frontend'), event('job.interrupted')] });
    expect(view.stages[0]?.status).toBe('interrupted');
    expect(view.currentStage).toBeNull();
  });

  it('does not guess how a job ended when the feed closed without saying', () => {
    expect(build({ events: [open('frontend')], feedEnded: true }).status).toBe('unknown');
  });

  it('trusts a settled summary when the terminal event is absent', () => {
    expect(build({ events: [open('frontend')], summary: summary('interrupted') }).status).toBe(
      'interrupted',
    );
  });

  it('uses the server duration, or the gap between server timestamps', () => {
    const started = open('frontend');
    const view = build({
      events: [
        started,
        event('stage.completed', {
          stage: 'frontend',
          data: { durationMs: 4200, summary: 'done' },
        }),
        open('security'),
        event('stage.completed', {
          stage: 'security',
          createdAt: '2026-11-09T12:10:00.000Z',
          data: {},
        }),
      ],
      summary: summary('succeeded'),
    });
    expect(view.stages[0]?.durationMs).toBe(4200);
    expect(view.stages[0]?.summary).toBe('done');
    expect(view.stages[1]?.durationMs).toBeGreaterThan(0);
  });

  it('shows a declared stage as pending only when it lies ahead of the work', () => {
    const plan: PlannedStage[] = ['a', 'b', 'c'].map((id) => ({ id, label: id }));
    const active = build({ events: [open('b')], plan });
    expect(active.stages.map((stage) => [stage.id, stage.status])).toEqual([
      ['b', 'running'],
      ['c', 'pending'],
    ]);
    const over = build({ events: [open('b'), event('job.failed')], plan });
    expect(over.stages.map((stage) => stage.id)).toEqual(['b']);
  });

  it('collapses the testing alias onto the verification row of a build', () => {
    const view = build({
      events: [
        open('verification'),
        event('verify.check', {
          stage: 'testing',
          status: 'failed',
          data: {
            id: 'build',
            command: 'npm run build',
            exitCode: 1,
            durationMs: 9,
            summary: 'bad',
          },
        }),
        event('verify.completed', {
          stage: 'testing',
          status: 'failed',
          data: { ok: false, durationMs: 10, failed: ['build'], limitations: ['no browser'] },
        }),
      ],
    });
    expect(view.stages).toHaveLength(1);
    expect(view.stages[0]?.checks[0]).toMatchObject({ id: 'build', exitCode: 1 });
    expect(view.verification).toEqual({
      ok: false,
      durationMs: 10,
      failed: ['build'],
      limitations: ['no browser'],
    });
  });

  it('does not count a passed-over declared stage as run', () => {
    const plan: PlannedStage[] = [
      { id: 'researching', label: 'R' },
      { id: 'planning', label: 'P' },
    ];
    const view = build({ jobKind: 'ENHANCEMENT', events: [open('planning')], plan });
    expect(view.stages.map((stage) => stage.id)).toEqual(['planning']);
  });

  it('keeps only known fields, so a stray payload cannot reach the page', () => {
    const view = build({
      events: [
        open('frontend'),
        event('note', { stage: 'frontend', data: { completion: 'SECRET LLM OUTPUT' } }),
      ],
    });
    expect(JSON.stringify(view)).not.toContain('SECRET LLM OUTPUT');
  });

  it('gathers changed files without repeats', () => {
    const data = { created: ['a.ts'], modified: ['b.ts'], deleted: [] };
    const view = build({
      events: [
        event('files.changed', { stage: 'frontend', data }),
        event('files.changed', { stage: 'security', data }),
      ],
    });
    expect(view.files).toEqual({ created: ['a.ts'], modified: ['b.ts'], deleted: [] });
  });
});

describe('totalUsage', () => {
  it('is unknown, not zero, when nothing reported a figure', () => {
    const totals = totalUsage([usage({ inputTokens: null, outputTokens: null, costUsd: null })]);
    expect(totals).toMatchObject({ inputTokens: null, outputTokens: null, costUsd: null });
  });

  it('sums what was reported and counts what was not', () => {
    expect(totalUsage([usage({}), usage({ inputTokens: null, costUsd: null })])).toMatchObject({
      calls: 2,
      inputTokens: 10,
      outputTokens: 10,
      costUsd: 0.5,
      unreportedTokens: 1,
      unreportedCost: 1,
    });
  });

  it('does not count a timing-only row as a model call', () => {
    const timing = usage({
      provider: null,
      model: null,
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
    });
    expect(totalUsage([timing])).toBeNull();
  });
});
