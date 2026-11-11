/**
 * The run-slot limit is per user and counts every project, but the preview
 * page is scoped to one project. A refused preview was therefore a dead end:
 * "stop one of your runs" named nothing the reader could see or reach. These
 * tests pin the way out — the other projects' runs are listed here, and each
 * can be stopped without leaving the page.
 *
 * The second half covers reopening the page on a run that is already up, and
 * the state a preview most often ends in when it does not come up at all.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/utils';
import type { PipelineArtifacts, RunSession } from '@/shared/types/api';
import { OtherRuns, PreviewWorkspace } from './preview-page';

const stopRunSession = vi.hoisted(() => vi.fn());
const createRunSession = vi.hoisted(() => vi.fn());
const getRunSession = vi.hoisted(() => vi.fn());
const listRunSessions = vi.hoisted(() => vi.fn());
const getRunLogs = vi.hoisted(() => vi.fn());
vi.mock('@/shared/services/runner.service', () => ({
  stopRunSession,
  createRunSession,
  restartRunSession: vi.fn(),
  getRunSession,
  getRunLogs,
  listRunSessions,
  planRunSession: vi.fn(),
}));

function session(name: string, id: string, overrides: Partial<RunSession> = {}): RunSession {
  return {
    id,
    projectName: name,
    phase: 'running',
    processes: [],
    transitions: [],
    workspaceDir: `/tmp/${id}`,
    diagnostics: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function renderOtherRuns(sessions: RunSession[]) {
  return renderWithProviders(<OtherRuns sessions={sessions} />);
}

describe('OtherRuns', () => {
  it('names each project holding a run slot', () => {
    renderOtherRuns([session('College', 'a'), session('NovaStack', 'b')]);
    expect(screen.getByText('College')).toBeInTheDocument();
    expect(screen.getByText('NovaStack')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /stop/i })).toHaveLength(2);
  });

  it('stops the run the reader picked, so a slot is freed from this page', async () => {
    stopRunSession.mockResolvedValue(session('College', 'a'));
    renderOtherRuns([session('College', 'a'), session('NovaStack', 'b')]);

    const [, novastack] = screen.getAllByRole('button', { name: /stop/i });
    if (!novastack) throw new Error('expected a stop button for every listed run');

    await userEvent.click(novastack);
    expect(stopRunSession).toHaveBeenCalledWith('b');
  });

  it('renders nothing when no other project is running', () => {
    const { container } = renderOtherRuns([]);
    expect(container).toBeEmptyDOMElement();
  });
});

const PROJECT = 'Task Tracker';

/**
 * Only the two fields this page reads. The real bundle is megabytes of
 * generated project, and none of it changes what is under test here.
 */
function artifacts(): PipelineArtifacts {
  return {
    architecture: { meta: { projectName: PROJECT, generatedAt: '2026-10-24T12:00:00.000Z' } },
    files: [{ path: 'package.json', content: '{}' }],
  } as unknown as PipelineArtifacts;
}

beforeEach(() => {
  stopRunSession.mockReset();
  createRunSession.mockReset();
  getRunSession.mockReset();
  listRunSessions.mockReset();
  getRunLogs.mockReset();
  listRunSessions.mockResolvedValue([]);
});

describe('PreviewWorkspace', () => {
  it('reattaches to the run this project already has up', async () => {
    // A reload, a bookmark, or coming back from another tab all land here
    // with the preview already installed and listening on its ports.
    const live = session(PROJECT, 'sess-1', {
      processes: [
        {
          kind: 'frontend',
          status: 'running',
          port: 5273,
          url: 'http://localhost:5273',
          command: 'npm run dev',
          pid: 4242,
          exitCode: null,
        },
      ],
    });
    listRunSessions.mockResolvedValue([live]);
    getRunSession.mockResolvedValue(live);

    renderWithProviders(<PreviewWorkspace artifacts={artifacts()} />);

    // The badge is the proof it attached: the phase can only come from the
    // session query, which only runs once a session id has been adopted.
    expect(await screen.findByText('Running')).toBeInTheDocument();
    await waitFor(() => {
      expect(getRunSession.mock.calls[0]?.[0]).toBe('sess-1');
    });
    expect(screen.getByTitle(`${PROJECT} preview`)).toBeInTheDocument();

    // Installing the same project a second time would fight the first one
    // for its ports and its workspace directory.
    expect(createRunSession).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /run preview/i })).toBeNull();
  });

  it('starts a preview when nothing of this project is up', async () => {
    listRunSessions.mockResolvedValue([session('College', 'other-1')]);
    createRunSession.mockResolvedValue(session(PROJECT, 'sess-2', { phase: 'installing' }));
    getRunSession.mockResolvedValue(session(PROJECT, 'sess-2', { phase: 'installing' }));
    getRunLogs.mockResolvedValue({ lines: [], nextCursor: 0 });

    renderWithProviders(<PreviewWorkspace artifacts={artifacts()} />);
    // Two offer it — the header action and the empty state — and either one
    // must start exactly one session.
    const [runPreview] = screen.getAllByRole('button', { name: /run preview/i });
    if (!runPreview) throw new Error('expected the page to offer a way to start the preview');
    await userEvent.click(runPreview);

    await waitFor(() => {
      expect(createRunSession).toHaveBeenCalledTimes(1);
    });
    expect(createRunSession.mock.calls[0]?.[0]).toEqual({
      projectName: PROJECT,
      files: [{ path: 'package.json', content: '{}' }],
    });
    // Another project's live run is not this project's run, so it must not
    // be mistaken for one — that would show a College preview under Task
    // Tracker's heading.
    expect(getRunSession.mock.calls.every((call) => call[0] === 'sess-2')).toBe(true);
  });

  it('shows what a failed preview reported, not just that it failed', async () => {
    // The session was starting when the page loaded, so it is adopted; the
    // first poll is what reveals it died on the way up.
    listRunSessions.mockResolvedValue([session(PROJECT, 'sess-3', { phase: 'starting' })]);
    getRunSession.mockResolvedValue(
      session(PROJECT, 'sess-3', {
        phase: 'failed',
        diagnostics: [
          'npm install exited with code 1',
          'prisma/schema.prisma: Error validating model "Task"',
        ],
      }),
    );

    renderWithProviders(<PreviewWorkspace artifacts={artifacts()} />);

    expect(await screen.findByText('The preview could not start')).toBeInTheDocument();
    // "It failed" is unactionable. The install output names the generated
    // file that is wrong, which is the only thing that leads anywhere.
    expect(screen.getByText('npm install exited with code 1')).toBeInTheDocument();
    expect(
      screen.getByText('prisma/schema.prisma: Error validating model "Task"'),
    ).toBeInTheDocument();
    // And a failed session can be restarted in place rather than started
    // again from scratch, which would leave the dead workspace behind.
    expect(screen.getByRole('button', { name: /restart/i })).toBeInTheDocument();
  });

  it('says so plainly when a failed preview captured no diagnostics at all', async () => {
    listRunSessions.mockResolvedValue([session(PROJECT, 'sess-4', { phase: 'starting' })]);
    getRunSession.mockResolvedValue(
      session(PROJECT, 'sess-4', { phase: 'failed', diagnostics: null }),
    );

    renderWithProviders(<PreviewWorkspace artifacts={artifacts()} />);

    expect(await screen.findByText('No diagnostics were captured.')).toBeInTheDocument();
  });
});
