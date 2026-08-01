/**
 * use-runner hook tests, focused on the piece with real logic: the log
 * accumulator. The server only ever sends lines after a cursor; the hook
 * must accumulate across polls, advance the cursor so nothing is fetched
 * twice, and reset cleanly when the session changes. The service module
 * is mocked at the import boundary — the axios layer has its own tests.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RunLogChunk } from '@/shared/types/api';
import { getRunLogs } from '@/shared/services/runner.service';
import { useRunLogs } from './use-runner';

vi.mock('@/shared/services/runner.service', () => ({
  getRunLogs: vi.fn(),
}));

const mockedGetRunLogs = vi.mocked(getRunLogs);

function chunk(seqStart: number, lines: string[], nextCursor: number): RunLogChunk {
  return {
    lines: lines.map((line, index) => ({
      seq: seqStart + index,
      stream: 'backend',
      line,
      at: '2026-07-22T12:00:00.000Z',
    })),
    nextCursor,
  };
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  mockedGetRunLogs.mockReset();
});

describe('useRunLogs', () => {
  it('accumulates lines across polls and only asks for what is new', async () => {
    mockedGetRunLogs
      .mockResolvedValueOnce(chunk(1, ['installing', 'compiling'], 2))
      .mockResolvedValueOnce(chunk(3, ['listening on 4000'], 3));

    const wrapper = createWrapper();
    const { result } = renderHook(() => useRunLogs('session-1', false), { wrapper });

    await waitFor(() => {
      expect(result.current.lines).toHaveLength(2);
    });
    expect(mockedGetRunLogs).toHaveBeenLastCalledWith('session-1', 0);

    await result.current.refetch();
    await waitFor(() => {
      expect(result.current.lines).toHaveLength(3);
    });
    // The second poll must resume from the advanced cursor, not zero.
    expect(mockedGetRunLogs).toHaveBeenLastCalledWith('session-1', 2);
    expect(result.current.lines.map((l) => l.line)).toEqual([
      'installing',
      'compiling',
      'listening on 4000',
    ]);
  });

  it('resets the accumulator when the session changes', async () => {
    mockedGetRunLogs
      .mockResolvedValueOnce(chunk(1, ['first session line'], 1))
      .mockResolvedValueOnce(chunk(1, ['second session line'], 1));

    const wrapper = createWrapper();
    const { result, rerender } = renderHook(({ id }) => useRunLogs(id, false), {
      wrapper,
      initialProps: { id: 'session-1' },
    });

    await waitFor(() => {
      expect(result.current.lines).toHaveLength(1);
    });

    rerender({ id: 'session-2' });
    await waitFor(() => {
      expect(result.current.lines.map((l) => l.line)).toEqual(['second session line']);
    });
    // A fresh session starts from cursor zero again.
    expect(mockedGetRunLogs).toHaveBeenLastCalledWith('session-2', 0);
  });

  it('does not fetch at all without a session id', () => {
    const wrapper = createWrapper();
    const { result } = renderHook(() => useRunLogs(null, false), { wrapper });

    expect(result.current.lines).toEqual([]);
    expect(mockedGetRunLogs).not.toHaveBeenCalled();
  });
});
