/**
 * The polling contract of a background edit.
 *
 * An apply now outlives its request, so these hooks are the only thing that
 * knows whether an edit is still running. Three properties matter more than
 * any interval: polling stops for good once the job is over, it slows down as
 * the job ages rather than hammering a five-minute build every second, and a
 * failed poll keeps the progress it already has instead of resetting the
 * screen to nothing.
 *
 * The intervals themselves are deliberately never asserted. Every test here
 * advances the clock by a window wider than the slowest schedule the hook
 * could choose and counts what happened, so retuning the backoff stays a free
 * change and breaking the behaviour does not.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  applyEdit,
  fetchCurrentEditJob,
  fetchEditJob,
} from '@/shared/services/project-editor.service';
import {
  isTerminalEditJob,
  useApplyEdit,
  useCurrentEditJob,
  useEditJob,
} from './use-project-edits';
import type { EditJob, EditJobStatus } from '@/shared/types/api';

vi.mock('@/shared/services/project-editor.service', () => ({
  planEdit: vi.fn(),
  fetchEditPlan: vi.fn(),
  applyEdit: vi.fn(),
  fetchEditJob: vi.fn(),
  fetchCurrentEditJob: vi.fn(),
}));

const mockedApplyEdit = vi.mocked(applyEdit);
const mockedFetchEditJob = vi.mocked(fetchEditJob);
const mockedFetchCurrentEditJob = vi.mocked(fetchCurrentEditJob);

/** A fixed clock, so "five minutes into the edit" is a value and not a wait. */
const NOW = new Date('2026-10-24T12:00:00.000Z');

/**
 * Wider than the longest gap the hook can leave between polls, so "at least
 * one poll happened in here" holds whatever schedule it picks.
 */
const POLL_WINDOW_MS = 10_000;

function job(overrides: Partial<EditJob> = {}): EditJob {
  const at = NOW.toISOString();
  return {
    id: 'job-1',
    projectId: 'project-1',
    planId: 'plan-1',
    status: 'RUNNING',
    stage: 'rebuilding',
    stages: [{ stage: 'queued', startedAt: at, completedAt: at, detail: null }],
    instruction: 'Make the hero warmer and put the menu first',
    result: null,
    error: null,
    runId: null,
    startedAt: at,
    completedAt: null,
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
}

function createClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

/**
 * Move the fake clock and let everything it unblocks settle.
 *
 * Testing Library's `waitFor` cannot see Vitest's fake timers — its detection
 * looks for Jest — so under them it would wait on a clock nobody winds.
 * Advancing inside `act` is the honest equivalent: the query fires its polls
 * and React applies what came back.
 */
async function tick(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  mockedApplyEdit.mockReset();
  mockedFetchEditJob.mockReset();
  mockedFetchCurrentEditJob.mockReset();
  mockedFetchCurrentEditJob.mockResolvedValue(null);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('isTerminalEditJob', () => {
  it('treats every ending as an ending, including the two that are not failures', () => {
    const terminal: EditJobStatus[] = ['SUCCEEDED', 'REJECTED', 'FAILED', 'INTERRUPTED'];
    for (const status of terminal) {
      expect(isTerminalEditJob(status)).toBe(true);
    }

    const live: EditJobStatus[] = ['QUEUED', 'RUNNING'];
    for (const status of live) {
      expect(isTerminalEditJob(status)).toBe(false);
    }
  });
});

describe('useEditJob', () => {
  it('keeps asking while the edit runs and stops for good once it is over', async () => {
    let served = job({ stage: 'rebuilding' });
    mockedFetchEditJob.mockImplementation(() => Promise.resolve(served));

    const { result } = renderHook(() => useEditJob('project-1', 'job-1'), {
      wrapper: wrapperFor(createClient()),
    });

    await tick();
    expect(result.current.data?.stage).toBe('rebuilding');
    const afterFirstRead = mockedFetchEditJob.mock.calls.length;

    // The server moves on; the hook must find out without being asked.
    served = job({ stage: 'validating' });
    await tick(POLL_WINDOW_MS);
    expect(result.current.data?.stage).toBe('validating');
    expect(mockedFetchEditJob.mock.calls.length).toBeGreaterThan(afterFirstRead);

    served = job({
      status: 'SUCCEEDED',
      stage: 'finished',
      completedAt: NOW.toISOString(),
    });
    await tick(POLL_WINDOW_MS);
    expect(result.current.data?.status).toBe('SUCCEEDED');

    // A finished job never changes again, so a tab left open on one must stop
    // costing requests — minutes of clock with nothing to show for it.
    const afterFinishing = mockedFetchEditJob.mock.calls.length;
    await tick(POLL_WINDOW_MS * 30);
    expect(mockedFetchEditJob.mock.calls.length).toBe(afterFinishing);
  });

  it('polls a long-running edit less often than one that just started', async () => {
    async function pollsInWindow(startedAt: Date): Promise<number> {
      mockedFetchEditJob.mockClear();
      mockedFetchEditJob.mockImplementation(() =>
        Promise.resolve(job({ startedAt: startedAt.toISOString() })),
      );
      const { unmount } = renderHook(() => useEditJob('project-1', 'job-1'), {
        wrapper: wrapperFor(createClient()),
      });
      await tick();
      const afterFirstRead = mockedFetchEditJob.mock.calls.length;
      await tick(POLL_WINDOW_MS);
      const polls = mockedFetchEditJob.mock.calls.length - afterFirstRead;
      unmount();
      return polls;
    }

    const justStarted = await pollsInWindow(NOW);
    const fiveMinutesIn = await pollsInWindow(new Date(NOW.getTime() - 5 * 60_000));

    // Both must still be alive — backing off is not the same as giving up.
    expect(fiveMinutesIn).toBeGreaterThan(0);
    expect(justStarted).toBeGreaterThan(fiveMinutesIn);
  });

  it('asks nothing at all until there is a job to watch', async () => {
    renderHook(() => useEditJob('project-1', null), { wrapper: wrapperFor(createClient()) });

    await tick(POLL_WINDOW_MS * 5);
    expect(mockedFetchEditJob).not.toHaveBeenCalled();
  });

  it('keeps the progress it already has when a poll fails, and recovers on the next one', async () => {
    mockedFetchEditJob
      .mockResolvedValueOnce(job({ stage: 'rebuilding' }))
      // Every poll after the first one fails, so the outage lasts as long as
      // the test wants it to rather than as long as one interval.
      .mockRejectedValue(new Error('Network Error'));

    const { result } = renderHook(() => useEditJob('project-1', 'job-1'), {
      wrapper: wrapperFor(createClient()),
    });

    await tick();
    expect(result.current.data?.stage).toBe('rebuilding');
    // Read the error here as well as below: the query result only re-renders
    // its consumer for fields that consumer has looked at, so a reader that
    // never looks at `error` is never told about one.
    expect(result.current.error).toBeNull();

    await tick(POLL_WINDOW_MS);
    // The failure is reported, and the last thing the server actually said is
    // still here: losing contact must not read as "the edit went away".
    expect(result.current.error).toEqual(new Error('Network Error'));
    expect(result.current.data?.stage).toBe('rebuilding');

    // Polling has to survive the outage too — one dropped request must not
    // leave the panel watching a job it will never ask about again.
    mockedFetchEditJob.mockReset();
    mockedFetchEditJob.mockResolvedValue(job({ stage: 'validating' }));
    await tick(POLL_WINDOW_MS);
    expect(result.current.data?.stage).toBe('validating');
    expect(result.current.error).toBeNull();
  });
});

describe('useCurrentEditJob', () => {
  it('asks the project what it is doing once, and does not poll it', async () => {
    mockedFetchCurrentEditJob.mockResolvedValue(job({ status: 'RUNNING' }));

    const { result } = renderHook(() => useCurrentEditJob('project-1'), {
      wrapper: wrapperFor(createClient()),
    });

    await tick();
    expect(result.current.data?.id).toBe('job-1');
    expect(mockedFetchCurrentEditJob).toHaveBeenCalledTimes(1);

    // The job it points at is polled by `useEditJob`; asking the project again
    // on a timer would just double every edit's request count.
    await tick(POLL_WINDOW_MS * 30);
    expect(mockedFetchCurrentEditJob).toHaveBeenCalledTimes(1);
  });

  it('reports a project with no edit as no edit, rather than as a failure', async () => {
    mockedFetchCurrentEditJob.mockResolvedValue(null);

    const { result } = renderHook(() => useCurrentEditJob('project-1'), {
      wrapper: wrapperFor(createClient()),
    });

    await tick();
    expect(result.current.data).toBeNull();
    expect(result.current.isError).toBe(false);
  });
});

describe('useApplyEdit', () => {
  it('hands the started job straight to the watcher, with no blank frame in between', async () => {
    const started = job({ status: 'QUEUED', stage: 'queued' });
    mockedApplyEdit.mockResolvedValue(started);
    // A read that never answers: anything the watcher shows below can only
    // have come from what the apply put in the cache.
    mockedFetchEditJob.mockImplementation(() => new Promise<EditJob>(() => undefined));
    const client = createClient();
    const wrapper = wrapperFor(client);

    const { result } = renderHook(() => useApplyEdit('project-1'), { wrapper });
    await act(async () => {
      await result.current.mutateAsync('plan-1');
    });

    // The apply response *is* the job, so the first render of the watcher has
    // it already — the user sees "Queued", not an empty panel.
    const watcher = renderHook(() => useEditJob('project-1', 'job-1'), { wrapper });
    expect(watcher.result.current.data?.status).toBe('QUEUED');
  });
});
