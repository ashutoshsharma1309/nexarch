import { describe, expect, it, vi } from 'vitest';

import { INITIAL_FEED_STATE, startExecutionFeed } from './execution-feed';
import type { ExecutionFeedDeps, ExecutionFeedState } from './execution-feed';
import type { StreamOutcome } from './execution-stream';
import type { ExecutionEvent } from '@/shared/types/execution';

function event(seq: number, type = 'note'): ExecutionEvent {
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
    message: `event ${String(seq)}`,
    data: null,
    createdAt: '2026-11-09T12:00:00.000Z',
  };
}

type OpenStream = ExecutionFeedDeps['openStream'];

/** Runs a feed to rest with waits collapsed, and returns every state it passed through. */
async function run(deps: Partial<ExecutionFeedDeps>) {
  const states: ExecutionFeedState[] = [];
  let final = INITIAL_FEED_STATE;
  const sleep = vi.fn(() => Promise.resolve());
  const full: ExecutionFeedDeps = {
    fetchEvents: vi.fn(() => Promise.resolve([])),
    openStream: vi.fn(() => Promise.resolve<StreamOutcome>({ kind: 'closed' })),
    isJobSettled: vi.fn(() => Promise.resolve(true)),
    sleep,
    ...deps,
  };
  await new Promise<void>((resolve) => {
    const stop = startExecutionFeed(full, (state) => {
      states.push(state);
      final = state;
      if (state.connection === 'ended' || state.connection === 'error') {
        queueMicrotask(() => {
          stop();
          resolve();
        });
      }
    });
  });
  return { states, final, sleep, deps: full };
}

const seqs = (state: ExecutionFeedState) => state.events.map((item) => item.seq);
const ended: StreamOutcome = { kind: 'ended', end: { reason: 'terminal-event', lastSeq: 2 } };

describe('startExecutionFeed', () => {
  it('restores history and never opens a stream for a job already over', async () => {
    const openStream = vi.fn<OpenStream>();
    const { final } = await run({
      fetchEvents: () => Promise.resolve([event(1, 'job.started'), event(2, 'job.completed')]),
      openStream,
    });
    expect(seqs(final)).toEqual([1, 2]);
    expect(final.connection).toBe('ended');
    expect(openStream).not.toHaveBeenCalled();
  });

  it('resumes from the last persisted seq and does not double a replayed event', async () => {
    const openStream = vi.fn<OpenStream>((_after, handlers) => {
      handlers.onOpen();
      handlers.onEvent(event(2));
      handlers.onEvent(event(3));
      return Promise.resolve(ended);
    });
    const { final, states } = await run({
      fetchEvents: (after) => Promise.resolve(after === 0 ? [event(1), event(2)] : []),
      openStream,
    });
    expect(openStream.mock.calls[0]?.[0]).toBe(2);
    expect(seqs(final)).toEqual([1, 2, 3]);
    expect(states.some((state) => state.connection === 'live')).toBe(true);
    expect(final.endReason).toBe('terminal-event');
  });

  it('reconnects from the newest seq after a dropped connection', async () => {
    const outcomes: StreamOutcome[] = [{ kind: 'closed' }, ended];
    const openStream = vi.fn<OpenStream>((after, handlers) => {
      if (after === 1) handlers.onEvent(event(2));
      return Promise.resolve(outcomes.shift() ?? ended);
    });
    await run({
      fetchEvents: (after) => Promise.resolve(after === 0 ? [event(1)] : []),
      openStream,
    });
    expect(openStream.mock.calls.map((call) => call[0])).toEqual([1, 2]);
  });

  it('falls back to polling after repeated failures and stops when the job settles', async () => {
    const openStream = vi.fn<OpenStream>(() =>
      Promise.resolve<StreamOutcome>({ kind: 'network-error' }),
    );
    let reads = 0;
    const { final, states } = await run({
      fetchEvents: () => {
        reads += 1;
        return Promise.resolve(reads === 2 ? [event(1)] : []);
      },
      openStream,
    });
    expect(openStream).toHaveBeenCalledTimes(3);
    expect(states.some((state) => state.connection === 'polling')).toBe(true);
    expect(seqs(final)).toEqual([1]);
    expect(final.endReason).toBe('job-settled');
  });

  it('goes through the refresh flow on a 401 and keeps what that returned', async () => {
    const outcomes: StreamOutcome[] = [{ kind: 'http-error', status: 401 }, ended];
    const fetchEvents = vi.fn((after: number) =>
      Promise.resolve(after === 0 ? [] : [event(after + 1)]),
    );
    fetchEvents.mockResolvedValueOnce([event(1)]);
    const { final } = await run({
      fetchEvents,
      openStream: () => Promise.resolve(outcomes.shift() ?? ended),
    });
    expect(seqs(final)).toContain(2);
  });

  it('retries a 404 while a just-started job is being written, then reports it', async () => {
    const openStream = vi.fn<OpenStream>(() =>
      Promise.resolve<StreamOutcome>({ kind: 'http-error', status: 404 }),
    );
    const { final } = await run({ openStream });
    expect(openStream.mock.calls.length).toBeGreaterThan(1);
    expect(final.connection).toBe('error');
    expect(final.error).toMatch(/no record/);
  });

  it('reports a failed history read instead of an empty timeline', async () => {
    const { final } = await run({
      fetchEvents: () => Promise.reject(new Error('Server unavailable')),
    });
    expect(final.connection).toBe('error');
    expect(final.historyLoaded).toBe(false);
    expect(final.error).toBe('Server unavailable');
  });

  it('never emits after being stopped', async () => {
    const onChange = vi.fn();
    const stop = startExecutionFeed(
      {
        fetchEvents: () => Promise.resolve([event(1)]),
        openStream: () => Promise.resolve<StreamOutcome>({ kind: 'aborted' }),
        isJobSettled: () => Promise.resolve(false),
      },
      onChange,
    );
    stop();
    const callsAtStop = onChange.mock.calls.length;
    await Promise.resolve();
    await Promise.resolve();
    expect(onChange.mock.calls.length).toBe(callsAtStop);
  });
});
