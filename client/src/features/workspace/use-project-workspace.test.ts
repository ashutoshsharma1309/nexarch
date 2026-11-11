/**
 * Which run the workspace is showing, and which one it is watching.
 *
 * Every tab in a project renders whatever this hook resolved, so the two
 * ways it can be wrong are both silent. Pick the wrong run and the reader is
 * shown a different build's requirements, schema and code under their
 * project's name — most dangerously by taking `runs[0]`, which after a failed
 * rebuild is the failure, not the last thing that worked. Poll the wrong run
 * and a build in flight either never updates or every historical run is
 * polled forever.
 *
 * The third case is the one `artifactsMissing` exists for: a completed run
 * whose output the server no longer holds. "Rebuild this project" and
 * "something went wrong" are different messages, and only this flag tells
 * them apart.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchArtifacts, fetchRun } from '@/shared/services/pipeline.service';
import { getProjectDashboard, listProjectRuns } from '@/shared/services/workspace.service';
import { createTestQueryClient, wrapperFor } from '@/test/utils';
import { useProjectWorkspace } from './use-project-workspace';
import type { PipelineArtifacts, PipelineRun, Project, Run } from '@/shared/types/api';

vi.mock('@/shared/services/workspace.service', () => ({
  createProject: vi.fn(),
  listProjects: vi.fn(),
  getProjectDashboard: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
  duplicateProject: vi.fn(),
  recordGeneration: vi.fn(),
  getWorkspaceStatistics: vi.fn(),
  getWorkspaceHistory: vi.fn(),
  generateDocumentation: vi.fn(),
  runExport: vi.fn(),
  listProjectRuns: vi.fn(),
}));

vi.mock('@/shared/services/pipeline.service', () => ({
  startRun: vi.fn(),
  fetchRun: vi.fn(),
  fetchRuns: vi.fn(),
  fetchArtifacts: vi.fn(),
  retryRun: vi.fn(),
}));

const mockedDashboard = vi.mocked(getProjectDashboard);
const mockedListProjectRuns = vi.mocked(listProjectRuns);
const mockedFetchRun = vi.mocked(fetchRun);
const mockedFetchArtifacts = vi.mocked(fetchArtifacts);

const project: Project = {
  id: 'project-1',
  ownerId: 'user-1',
  name: 'Task Tracker',
  slug: 'task-tracker',
  description: null,
  status: 'ACTIVE',
  favorite: false,
  createdAt: '2026-10-20T10:00:00.000Z',
  updatedAt: '2026-10-24T10:00:00.000Z',
};

/** Runs come back newest first, the way the endpoint orders them. */
function run(id: string, status: Run['status'], minutesAgo: number): Run {
  const at = new Date(Date.UTC(2026, 9, 24, 12, 0, 0) - minutesAgo * 60_000).toISOString();
  return {
    id,
    projectId: project.id,
    prompt: 'A task tracker',
    status,
    error: status === 'FAILED' ? 'frontend generation failed' : null,
    startedAt: at,
    completedAt: status === 'COMPLETED' || status === 'FAILED' ? at : null,
    createdAt: at,
    updatedAt: at,
  };
}

/** Only the fields `publishArtifacts` and the tabs read. */
function artifacts(runId: string): PipelineArtifacts {
  return {
    runId,
    requirements: { projectName: project.name, modules: [] },
    architecture: { meta: { projectName: project.name, generatedAt: '2026-10-24T12:00:00.000Z' } },
    design: {},
    backend: {},
    frontend: {},
    security: {},
    dependencies: {},
    files: [],
  } as unknown as PipelineArtifacts;
}

function pipelineRun(id: string): PipelineRun {
  return {
    id,
    projectId: project.id,
    projectName: project.name,
    prompt: 'A task tracker',
    status: 'running',
    stages: [],
    ai: {
      calls: 0,
      provider: 'groq',
      model: 'openai/gpt-oss-20b',
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
    },
    createdAt: '2026-10-24T12:00:00.000Z',
    updatedAt: '2026-10-24T12:00:00.000Z',
    error: null,
  };
}

function mount(runs: Run[]) {
  mockedListProjectRuns.mockResolvedValue(runs);
  return renderHook(() => useProjectWorkspace(project.id), {
    wrapper: wrapperFor(createTestQueryClient()),
  });
}

beforeEach(() => {
  mockedDashboard.mockReset();
  mockedListProjectRuns.mockReset();
  mockedFetchRun.mockReset();
  mockedFetchArtifacts.mockReset();
  mockedDashboard.mockResolvedValue({
    project,
    generations: [],
    latestGeneration: null,
    activity: [],
    stats: { totalGenerations: 0, completedGenerations: 0, failedGenerations: 0 },
  });
  mockedFetchRun.mockImplementation((id: string) => Promise.resolve(pipelineRun(id)));
  mockedFetchArtifacts.mockImplementation((id: string) => Promise.resolve(artifacts(id)));
});

describe('useProjectWorkspace — which run the project is', () => {
  it('shows the newest completed run, not merely the newest one', async () => {
    const { result } = mount([
      run('run-3', 'FAILED', 5),
      run('run-2', 'COMPLETED', 60),
      run('run-1', 'COMPLETED', 600),
    ]);

    await waitFor(() => {
      expect(result.current.latestRun?.id).toBe('run-2');
    });
    // A failed rebuild must not blank the project: the last build that
    // worked is still what this project *is*.
    expect(result.current.runs[0]?.id).toBe('run-3');
    expect(result.current.isBuilding).toBe(false);
  });

  it('has no content at all for a project that has never finished a build', async () => {
    const { result } = mount([run('run-1', 'FAILED', 5)]);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.latestRun).toBeUndefined();
    // Nothing completed, so there is nothing to ask for — and asking would
    // produce an error that reads as a missing-artifacts problem.
    expect(mockedFetchArtifacts).not.toHaveBeenCalled();
    expect(result.current.artifactsMissing).toBe(false);
  });

  it('reports a build in flight only while the newest run is unfinished', async () => {
    const building = mount([run('run-2', 'GENERATING', 1), run('run-1', 'COMPLETED', 60)]);
    await waitFor(() => {
      expect(building.result.current.isBuilding).toBe(true);
    });
    // The build is in flight, and the tabs still show the last good run.
    expect(building.result.current.latestRun?.id).toBe('run-1');
    building.unmount();

    for (const status of ['COMPLETED', 'FAILED'] as const) {
      const settled = mount([run('run-2', status, 1)]);
      await waitFor(() => {
        expect(settled.result.current.isLoading).toBe(false);
      });
      // Both are terminal server-side; "building" on either is a spinner
      // that never stops.
      expect(settled.result.current.isBuilding).toBe(false);
      settled.unmount();
    }
  });

  it('polls only the newest run, and only while it can still change', async () => {
    const { result } = mount([
      run('run-3', 'ANALYZING', 1),
      run('run-2', 'COMPLETED', 60),
      run('run-1', 'COMPLETED', 600),
    ]);

    await waitFor(() => {
      expect(result.current.liveRun?.id).toBe('run-3');
    });
    // Only the newest run can still be in flight. Polling the history would
    // be one request per second per run the project has ever had.
    expect(mockedFetchRun.mock.calls.every((call) => call[0] === 'run-3')).toBe(true);
  });

  it('does not poll anything once the newest run has finished', async () => {
    const { result } = mount([run('run-1', 'COMPLETED', 60)]);

    await waitFor(() => {
      expect(result.current.latestRun?.id).toBe('run-1');
    });
    expect(mockedFetchRun).not.toHaveBeenCalled();
    expect(result.current.liveRun).toBeUndefined();
  });
});

describe('useProjectWorkspace — artifacts that are gone', () => {
  it('reports a completed run whose output the server no longer holds', async () => {
    mockedFetchArtifacts.mockRejectedValue(new Error('Run not found'));
    const { result } = mount([run('run-1', 'COMPLETED', 600)]);

    await waitFor(() => {
      expect(result.current.artifactsMissing).toBe(true);
    });
    // The run itself is still real — the project has a history, it just has
    // no content to show. That is "rebuild this project", not an error.
    expect(result.current.latestRun?.id).toBe('run-1');
    expect(result.current.artifacts).toBeUndefined();
    expect(result.current.error).toBeNull();
  });

  it('is not missing anything when the artifacts load', async () => {
    const { result } = mount([run('run-1', 'COMPLETED', 600)]);

    await waitFor(() => {
      expect(result.current.artifacts?.runId).toBe('run-1');
    });
    expect(result.current.artifactsMissing).toBe(false);
    expect(mockedFetchArtifacts.mock.calls[0]?.[0]).toBe('run-1');
  });
});
