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
 * accepted a run, the run's own progress is on screen — for all three
 * endings, because a build that fails or finishes while the tab still reads
 * "Building" is the same lie as the original one.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchRun, retryRun, startRun } from '@/shared/services/pipeline.service';
import { deferred, renderWithProviders } from '@/test/utils';
import { BuildTab } from './build-tab';
import type { PipelineRun, PipelineStage } from '@/shared/types/api';

vi.mock('@/shared/services/pipeline.service', () => ({
  startRun: vi.fn(),
  fetchRun: vi.fn(),
  fetchRuns: vi.fn(),
  fetchArtifacts: vi.fn(),
  retryRun: vi.fn(),
}));

/**
 * The workspace this tab is mounted in. `liveRun` is writable because the
 * run the tab shows can come from either side of it — the one this tab just
 * started, or the one the project resolved on load — and the endings below
 * are reached the second way, by reopening the tab on a finished build.
 */
const workspace = {
  project: { id: 'project-1', name: 'Task Tracker', slug: 'task-tracker', status: 'DRAFT' },
  runs: [] as unknown[],
  latestRun: undefined,
  liveRun: undefined as PipelineRun | undefined,
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
const mockedRetryRun = vi.mocked(retryRun);

const PROMPT =
  'A task tracker where a signed-in user can create tasks, assign them to a project and ' +
  'mark them complete.';

function stage(overrides: Partial<PipelineStage> = {}): PipelineStage {
  return {
    id: 'analysis',
    label: 'Requirement Analysis',
    engine: 'ai',
    agentId: 'requirement-analyst',
    status: 'completed',
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: 1200,
    summary: null,
    error: null,
    degraded: false,
    ...overrides,
  };
}

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
  const user = userEvent.setup();
  const view = renderWithProviders(<BuildTab />, { router: true });
  return { user, client: view.client, unmount: view.unmount };
}

beforeEach(() => {
  mockedStartRun.mockReset();
  mockedFetchRun.mockReset();
  mockedRetryRun.mockReset();
  workspace.liveRun = undefined;
  workspace.runs = [];
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
    accepted.resolve(run());

    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['project', 'project-1', 'runs'] });
    });
  });
});

/**
 * The two states a build actually ends in.
 *
 * Both are reached here the way a user reaches them most often — by opening
 * the tab on a run that is already over — so what is under test is the tab's
 * reading of a finished run, not the request that started it.
 */
describe('a build that failed', () => {
  const failed = (): PipelineRun =>
    run({
      status: 'failed',
      error: 'frontend generation failed: the model returned no files',
      stages: [
        stage({ id: 'analysis', summary: '6 modules' }),
        stage({
          id: 'frontend',
          label: 'Frontend Generation',
          status: 'failed',
          durationMs: null,
          completedAt: null,
          error: 'the model returned no files',
        }),
      ],
    });

  it('says the build failed, and names what went wrong', async () => {
    workspace.liveRun = failed();
    renderTab();

    const progress = await screen.findByRole('region', { name: 'Build progress' });
    // "Building" on a run the server gave up on an hour ago is the failure
    // this whole file exists to prevent, in its most misleading form.
    expect(progress).toHaveTextContent('Build failed');
    expect(progress).not.toHaveTextContent('Building');
    expect(
      screen.getByText('frontend generation failed: the model returned no files'),
    ).toBeInTheDocument();
    // The stage that broke says so itself, so the reader knows how far the
    // run got rather than only that it stopped.
    expect(within(progress).getByText('the model returned no files')).toBeInTheDocument();
  });

  it('offers a retry, and then follows the run the retry created', async () => {
    workspace.liveRun = failed();
    mockedRetryRun.mockResolvedValue(run({ id: 'run-2', status: 'running' }));
    mockedFetchRun.mockResolvedValue(run({ id: 'run-2', status: 'running' }));

    const { user } = renderTab();
    await user.click(await screen.findByRole('button', { name: /retry build/i }));

    await waitFor(() => {
      expect(mockedRetryRun).toHaveBeenCalledTimes(1);
    });
    // The retry is the mutation function itself, and react-query hands that a
    // context object as a second argument — so the run id is read positionally
    // rather than by matching the whole call.
    expect(mockedRetryRun.mock.calls[0]?.[0]).toBe('run-1');
    // A retry nobody follows is the original bug wearing a different hat:
    // the server rebuilds the project while the screen still reads "failed".
    await waitFor(() => {
      expect(mockedFetchRun).toHaveBeenCalledWith('run-2');
    });
  });
});

describe('a build that completed', () => {
  it('reports the completion, each stage’s summary, and the way on', async () => {
    workspace.liveRun = run({
      status: 'completed',
      error: null,
      stages: [
        stage({ id: 'analysis', summary: '6 modules, 3 roles' }),
        stage({ id: 'database', label: 'Database Design', summary: '9 tables' }),
        stage({ id: 'security', label: 'Security Review', status: 'skipped', summary: null }),
      ],
      ai: {
        calls: 8,
        provider: 'groq',
        model: 'openai/gpt-oss-20b',
        inputTokens: 1_200,
        outputTokens: 300,
        estimatedCostUsd: 0.0123,
      },
    });
    renderTab();

    const progress = await screen.findByRole('region', { name: 'Build progress' });
    expect(progress).toHaveTextContent('Build complete');

    // The summaries are the only account of what was built; a completion
    // with no detail reads as "something happened".
    expect(within(progress).getByText('6 modules, 3 roles')).toBeInTheDocument();
    expect(within(progress).getByText('9 tables')).toBeInTheDocument();
    // What it cost is part of the result, not decoration.
    expect(progress).toHaveTextContent('1500 tokens');
    expect(progress).toHaveTextContent('$0.0123');

    // Completed stages link to the tab holding their output; the skipped one
    // produced nothing, so there is nowhere for it to lead.
    expect(within(progress).getByRole('link', { name: 'Database Design' })).toHaveAttribute(
      'href',
      '/projects/project-1/database',
    );
    expect(within(progress).queryByRole('link', { name: 'Security Review' })).toBeNull();
    expect(within(progress).getByRole('button', { name: /preview/i })).toBeInTheDocument();
  });

  it('does not call a build complete when its outcome says otherwise', async () => {
    workspace.liveRun = run({
      status: 'completed',
      outcome: 'incomplete',
      outcomeDetail: 'Built, but 2 of 7 requested capabilities are missing.',
    });
    renderTab();

    const progress = await screen.findByRole('region', { name: 'Build progress' });
    expect(progress).toHaveTextContent('Built, but not everything requested was delivered');
    expect(progress).not.toHaveTextContent('Build complete');
    expect(progress).toHaveTextContent('2 of 7 requested capabilities are missing');
  });

  it('keeps the plain heading for a run that really verified', async () => {
    workspace.liveRun = run({
      status: 'completed',
      outcome: 'verified',
      outcomeDetail: 'All checks passed.',
    });
    renderTab();

    const progress = await screen.findByRole('region', { name: 'Build progress' });
    expect(progress).toHaveTextContent('Build complete');
    expect(progress).not.toHaveTextContent('All checks passed.');
  });
});
