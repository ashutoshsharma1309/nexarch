/**
 * Starting a build, from the tab that starts it.
 *
 * There was no test here, and the gap cost a release: the end-to-end run
 * showed a build that the server accepted, ran and completed while the
 * console sat on an empty prompt box saying "Never built". Everything the
 * client needed was in the 202 — a run id and its stages — so the failure
 * was entirely in what this component did with the answer.
 *
 * So this asserts the one thing the tab exists to do: once the server has
 * accepted a run, the run's own progress is on screen.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchRun, startRun } from '@/shared/services/pipeline.service';
import { BuildTab } from './build-tab';
import type { PipelineRun } from '@/shared/types/api';

vi.mock('@/shared/services/pipeline.service', () => ({
  startRun: vi.fn(),
  fetchRun: vi.fn(),
  fetchRuns: vi.fn(),
  fetchArtifacts: vi.fn(),
  retryRun: vi.fn(),
}));

const workspace = {
  project: { id: 'project-1', name: 'Task Tracker', slug: 'task-tracker', status: 'DRAFT' },
  runs: [] as unknown[],
  latestRun: undefined,
  liveRun: undefined,
  artifacts: undefined,
  artifactsMissing: false,
  isLoading: false,
  isBuilding: false,
  error: null,
  notFound: false,
};

vi.mock('../workspace-context', () => ({ useWorkspace: () => workspace }));

const mockedStartRun = vi.mocked(startRun);
const mockedFetchRun = vi.mocked(fetchRun);

const PROMPT =
  'A task tracker where a signed-in user can create tasks, assign them to a project and ' +
  'mark them complete.';

function run(overrides: Partial<PipelineRun> = {}): PipelineRun {
  return {
    id: 'run-1',
    projectId: 'project-1',
    projectName: 'Task Tracker',
    prompt: PROMPT,
    status: 'running',
    stages: [
      {
        id: 'analysis',
        label: 'Requirement Analysis',
        engine: 'ai',
        agentId: 'requirement-analyst',
        status: 'running',
        startedAt: new Date().toISOString(),
        completedAt: null,
        durationMs: null,
        summary: null,
        error: null,
        degraded: false,
      },
    ],
    ai: {
      calls: 0,
      provider: 'groq',
      model: 'openai/gpt-oss-20b',
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    error: null,
    ...overrides,
  };
}

function renderTab() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const user = userEvent.setup();
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <BuildTab />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { user, client, unmount: view.unmount };
}

/** A promise the test settles itself, for the window the request is open. */
function deferred<T>(): { promise: Promise<T>; settle: (value: T) => void } {
  let settle: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    settle = (value) => {
      resolve(value);
    };
  });
  return { promise, settle };
}

beforeEach(() => {
  mockedStartRun.mockReset();
  mockedFetchRun.mockReset();
});

describe('starting a build', () => {
  it('shows the accepted run’s progress instead of an idle prompt box', async () => {
    mockedStartRun.mockResolvedValue(run());
    mockedFetchRun.mockResolvedValue(run());

    const { user } = renderTab();
    await user.type(screen.getByLabelText(/what should this project be/i), PROMPT);
    await user.click(screen.getByRole('button', { name: /build project/i }));

    // The server accepted it, so the run is what the reader should now see.
    await waitFor(() => {
      expect(mockedStartRun).toHaveBeenCalledTimes(1);
    });
    const progress = await screen.findByRole('region', { name: 'Build progress' });
    expect(progress).toHaveTextContent('Building');
    // And the run is actually being followed, rather than shown once and
    // then abandoned — which is what left a finished build invisible.
    await waitFor(() => {
      expect(mockedFetchRun).toHaveBeenCalledWith('run-1');
    });
  });

  it('still tells the project about a run whose starter unmounted', async () => {
    // The request resolves in about 150ms against a server, and anything
    // that replaces this subtree inside that window used to lose the run
    // entirely: the server built the project, the console said "Never
    // built". The news has to survive the component that asked for it.
    const accepted = deferred<PipelineRun>();
    mockedStartRun.mockReturnValue(accepted.promise);
    mockedFetchRun.mockResolvedValue(run());

    const { user, client, unmount } = renderTab();
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    await user.type(screen.getByLabelText(/what should this project be/i), PROMPT);
    await user.click(screen.getByRole('button', { name: /build project/i }));
    await waitFor(() => {
      expect(mockedStartRun).toHaveBeenCalledTimes(1);
    });

    unmount();
    accepted.settle(run());

    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['project', 'project-1', 'runs'] });
    });
  });
});
