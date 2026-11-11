import { screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fetchAllExecutionEvents,
  fetchExecutionJobs,
  fetchExecutionUsage,
} from '@/shared/services/execution.service';
import { openExecutionStream } from '@/shared/services/execution-stream';
import type { ExecutionEvent, ExecutionJobSummary } from '@/shared/types/execution';
import { renderWithProviders } from '@/test/utils';
import type { ProjectWorkspace } from '../use-project-workspace';
import { ProjectWorkspaceContext } from '../workspace-context';
import { ExecutionTab } from './execution-tab';

vi.mock('@/shared/services/execution.service', () => ({
  fetchExecutionJobs: vi.fn(),
  fetchAllExecutionEvents: vi.fn(),
  fetchExecutionUsage: vi.fn(),
}));
vi.mock('@/shared/services/execution-stream', () => ({ openExecutionStream: vi.fn() }));

const jobs = vi.mocked(fetchExecutionJobs);
const events = vi.mocked(fetchAllExecutionEvents);
const usage = vi.mocked(fetchExecutionUsage);
const stream = vi.mocked(openExecutionStream);

const workspace = {
  project: { id: 'p1' },
  runs: [],
  latestRun: undefined,
  liveRun: undefined,
  artifacts: undefined,
  artifactsMissing: false,
  isLoading: false,
  isBuilding: false,
  error: null,
  notFound: false,
} as unknown as ProjectWorkspace;

function show(ui: ReactElement = <ExecutionTab />) {
  return renderWithProviders(
    <ProjectWorkspaceContext.Provider value={workspace}>{ui}</ProjectWorkspaceContext.Provider>,
  );
}

function job(overrides: Partial<ExecutionJobSummary> = {}): ExecutionJobSummary {
  return {
    jobId: 'job-12345678',
    jobKind: 'RUN',
    status: 'succeeded',
    title: 'Clinic',
    createdAt: '2026-11-09T12:00:00.000Z',
    eventCount: 3,
    lastSeq: 3,
    lastEventAt: '2026-11-09T12:00:09.000Z',
    ...overrides,
  };
}

function event(seq: number, type: string, overrides: Partial<ExecutionEvent> = {}): ExecutionEvent {
  return {
    id: `e${String(seq)}`,
    projectId: 'p1',
    jobKind: 'RUN',
    jobId: 'job-12345678',
    seq,
    type,
    status: 'info',
    stage: null,
    agentId: null,
    message: `${type} line`,
    data: null,
    createdAt: `2026-11-09T12:00:0${String(seq)}.000Z`,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  usage.mockResolvedValue([]);
  // A stream that stays open, as a real one does between events.
  stream.mockImplementation(() => new Promise(() => undefined));
});

describe('ExecutionTab', () => {
  it('says so when nothing has been recorded', async () => {
    jobs.mockResolvedValue([]);
    show();
    expect(await screen.findByText('No executions recorded yet')).toBeInTheDocument();
  });

  it('offers a retry when the job list cannot be read', async () => {
    jobs.mockRejectedValue(new Error('List failed'));
    show();
    expect(await screen.findByText('List failed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('restores a finished job from persisted events without opening a stream', async () => {
    jobs.mockResolvedValue([job()]);
    events.mockResolvedValue([
      event(1, 'job.started'),
      event(2, 'stage.started', { stage: 'frontend', agentId: 'frontend-engineer' }),
      event(3, 'stage.completed', {
        stage: 'frontend',
        data: { durationMs: 1500, summary: '12 pages' },
      }),
      event(4, 'job.completed'),
    ]);
    show();
    expect(await screen.findByText('Frontend Generation')).toBeInTheDocument();
    expect(screen.getAllByText('Completed').length).toBeGreaterThan(0);
    expect(screen.getByText('1.5 s')).toBeInTheDocument();
    expect(stream).not.toHaveBeenCalled();
  });

  it('shows a job with no events as having no history, not as a success', async () => {
    jobs.mockResolvedValue([job({ eventCount: 0, lastSeq: 0 })]);
    events.mockResolvedValue([]);
    stream.mockResolvedValue({ kind: 'ended', end: { reason: 'job-settled', lastSeq: 0 } });
    show();
    expect(
      await screen.findByText('No execution history recorded for this run'),
    ).toBeInTheDocument();
  });

  it('shows what a running job is really doing and claims no progress of its own', async () => {
    jobs.mockResolvedValue([job({ status: 'running' })]);
    events.mockResolvedValue([
      event(1, 'job.started'),
      event(2, 'stage.started', {
        stage: 'research',
        agentId: 'research-analyst',
        message: 'Web Research started',
      }),
    ]);
    show();
    expect(await screen.findByText('Researching')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Web Research started');
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(stream.mock.calls[0]?.[0]).toMatchObject({ afterSeq: 2 });
    });
  });

  it('reports usage as not available when the server has none', async () => {
    jobs.mockResolvedValue([job()]);
    events.mockResolvedValue([
      event(1, 'stage.started', { stage: 'graph' }),
      event(2, 'job.completed'),
    ]);
    show();
    await screen.findByText('Engineering Graph');
    expect(screen.getAllByText('Not available').length).toBeGreaterThanOrEqual(2);
  });

  it('offers a retry when the history cannot be read', async () => {
    jobs.mockResolvedValue([job()]);
    events.mockRejectedValue(new Error('History failed'));
    show();
    expect(await screen.findByText('Could not load this execution')).toBeInTheDocument();
    expect(screen.getByText('History failed')).toBeInTheDocument();
  });

  it('renders no link for a source URL that is not plain http(s)', async () => {
    jobs.mockResolvedValue([job()]);
    events.mockResolvedValue([
      event(1, 'research.source', {
        stage: 'research',
        data: { url: 'javascript:alert(1)', title: 'Evil', retrieval: 'search-snippet' },
      }),
      event(2, 'job.completed'),
    ]);
    show();
    await screen.findByText('Web Research');
    expect(screen.getByText('Evil').closest('a')).toBeNull();
  });
});
