/**
 * The execution timeline, from a reader's side.
 *
 * The two things worth pinning here are the ones that would quietly mislead:
 * a figure nothing measured must read as "not measured" rather than as a
 * zero, and an empty list must not read as "this run did nothing" when the
 * real reason is that the API process restarted. Both are statements about
 * what the platform does not know, which is exactly the kind of claim that
 * rots silently.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchTimeline, fetchTimelines } from '@/shared/services/observability.service';
import { ExecutionSection } from './execution-section';
import type { Timeline, TimelineSummary } from '@/shared/types/timeline';

vi.mock('@/shared/services/observability.service', () => ({
  fetchTimelines: vi.fn(),
  fetchTimeline: vi.fn(),
}));

const workspace = {
  project: { id: 'project-1', name: 'Demo', slug: 'demo', status: 'ACTIVE' },
  runs: [{ id: 'run-1', status: 'COMPLETED' }],
  latestRun: { id: 'run-1', status: 'COMPLETED' },
  liveRun: undefined,
  artifacts: undefined,
  artifactsMissing: false,
  isLoading: false,
  isBuilding: false,
  error: null,
  notFound: false,
};

vi.mock('../../workspace-context', () => ({ useWorkspace: () => workspace }));

const mockedList = vi.mocked(fetchTimelines);
const mockedOne = vi.mocked(fetchTimeline);

function summary(overrides: Partial<TimelineSummary> = {}): TimelineSummary {
  return {
    slowestStage: { stage: 'backend', durationMs: 9_000 },
    totalStageMs: 10_600,
    failedAgents: [],
    degradedAgents: [],
    retries: 0,
    modelCalls: 3,
    cachedModelCalls: 0,
    failedModelCalls: 0,
    modelRetries: null,
    costUsd: 0.0019,
    validationMs: null,
    validationsPassed: 0,
    validationsFailed: 0,
    repairAttempts: 0,
    repairsFixed: 0,
    rollbacks: 0,
    unexpectedProcessExits: 0,
    firstFailureReason: null,
    ...overrides,
  };
}

function timeline(overrides: Partial<Timeline> = {}): Timeline {
  return {
    key: 'run-1',
    startedAt: '2026-10-31T12:10:39.238Z',
    updatedAt: '2026-10-31T12:10:49.475Z',
    entries: [
      {
        at: '2026-10-31T12:10:39.238Z',
        event: { event: 'run.start', trigger: 'prompt', stages: 8 },
      },
      {
        at: '2026-10-31T12:10:43.696Z',
        event: { event: 'stage.end', stage: 'analysis', outcome: 'completed', durationMs: 4458 },
      },
    ],
    truncated: false,
    summary: summary(),
    ...overrides,
  };
}

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <ExecutionSection />
    </QueryClientProvider>,
  );
  return { user };
}

beforeEach(() => {
  mockedList.mockReset();
  mockedOne.mockReset();
});

const header = (key: string, events: number) => ({
  key,
  startedAt: '2026-10-31T12:10:39.238Z',
  updatedAt: '2026-10-31T12:10:49.475Z',
  events,
  truncated: false,
  summary: summary(),
});

describe('execution timeline section', () => {
  it('shows the measured figures and the real event sequence', async () => {
    mockedList.mockResolvedValue({ timelines: [header('run-1', 21)], retention: 'in-memory' });
    mockedOne.mockResolvedValue(timeline());

    renderSection();

    // The question the section exists to answer, without the reader doing
    // arithmetic over a log file.
    expect(await screen.findByText(/backend · 9.0s/)).toBeInTheDocument();
    const sequence = screen.getByRole('list', { name: 'Event sequence' });
    expect(sequence).toHaveTextContent('run.start');
    expect(sequence).toHaveTextContent('stage.end');
    expect(sequence).toHaveTextContent('4.5s');
  });

  it('says "not measured" rather than zero for what nothing measured', async () => {
    mockedList.mockResolvedValue({ timelines: [header('run-1', 2)], retention: 'in-memory' });
    mockedOne.mockResolvedValue(
      timeline({ summary: summary({ validationMs: null, costUsd: null }) }),
    );

    renderSection();

    await screen.findByText(/backend · 9.0s/);
    // "validated in 0ms" and "nothing validated" are different facts, and
    // only the second one is true here.
    expect(screen.getAllByText('not measured').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText('$0.0000')).not.toBeInTheDocument();
    expect(screen.queryByText('0ms')).not.toBeInTheDocument();
  });

  it('explains an empty list instead of implying the run did nothing', async () => {
    mockedList.mockResolvedValue({ timelines: [], retention: 'in-memory' });

    renderSection();

    expect(await screen.findByText(/No execution timeline is held/)).toBeInTheDocument();
    expect(screen.getByText(/a restart clears them/)).toBeInTheDocument();
    expect(screen.getByText(/server log remains the durable record/)).toBeInTheDocument();
  });

  it('asks the server for this project’s executions, not for everything', async () => {
    // Scoping has to happen server-side: an edit job and a preview session
    // are keyed by their own ids, so filtering here against the project's
    // run ids dropped a real edit's timeline and claimed none was held.
    mockedList.mockResolvedValue({ timelines: [header('job-7', 9)], retention: 'in-memory' });
    mockedOne.mockResolvedValue(timeline({ key: 'job-7' }));

    renderSection();

    await screen.findByText(/backend · 9.0s/);
    expect(mockedList).toHaveBeenCalledWith('project-1');
    // And a timeline keyed by something other than a run id is shown, rather
    // than filtered out for not looking like a build.
    expect(mockedOne).toHaveBeenCalledWith('job-7');
  });

  it('surfaces what went wrong, naming the agent and the first reason', async () => {
    mockedList.mockResolvedValue({ timelines: [header('run-1', 12)], retention: 'in-memory' });
    mockedOne.mockResolvedValue(
      timeline({
        summary: summary({
          failedAgents: ['backend-engineer'],
          validationsFailed: 2,
          unexpectedProcessExits: 1,
          firstFailureReason: 'provider unreachable',
        }),
      }),
    );

    renderSection();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('backend-engineer');
    expect(alert).toHaveTextContent('2 validations failed');
    expect(alert).toHaveTextContent('1 processes exited unexpectedly');
    expect(alert).toHaveTextContent('provider unreachable');
  });

  it('admits when it stopped collecting rather than looking complete', async () => {
    mockedList.mockResolvedValue({ timelines: [header('run-1', 500)], retention: 'in-memory' });
    mockedOne.mockResolvedValue(timeline({ truncated: true }));

    renderSection();

    expect(await screen.findByText(/not all of it/)).toBeInTheDocument();
  });

  it('says a timeline is gone when the process that held it restarted', async () => {
    mockedList.mockResolvedValue({ timelines: [header('run-1', 21)], retention: 'in-memory' });
    mockedOne.mockRejectedValue(new Error('not found'));

    renderSection();

    expect(await screen.findByText(/no longer held/)).toBeInTheDocument();
  });
});
