/**
 * One job's event feed: persisted history first, then the live stream, then
 * polling if the stream cannot be held.
 *
 * It holds only what the server sent. The waits in here pace reconnects and
 * polls; none of them moves anything on the screen, and nothing advances
 * unless an event arrived.
 */
import type { StreamOutcome } from './execution-stream';
import type { ExecutionEvent, ExecutionStreamEnd } from '@/shared/types/execution';

export type FeedConnection =
  'loading' | 'connecting' | 'live' | 'reconnecting' | 'polling' | 'ended' | 'error';

export interface ExecutionFeedState {
  events: ExecutionEvent[];
  connection: FeedConnection;
  /** False until persisted history has been read once. */
  historyLoaded: boolean;
  /** Set while reads are failing; events already held stay on screen. */
  error: string | null;
  endReason: ExecutionStreamEnd['reason'] | null;
}

export const INITIAL_FEED_STATE: ExecutionFeedState = {
  events: [],
  connection: 'loading',
  historyLoaded: false,
  error: null,
  endReason: null,
};

export interface ExecutionFeedDeps {
  /** All events after `after`, every page. Goes through the app's refresh flow. */
  fetchEvents: (after: number) => Promise<ExecutionEvent[]>;
  openStream: (
    afterSeq: number,
    handlers: { onOpen: () => void; onEvent: (event: ExecutionEvent) => void },
    signal: AbortSignal,
  ) => Promise<StreamOutcome>;
  /** Only polling needs this: a job can stop without a terminal event. */
  isJobSettled: () => Promise<boolean>;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

const TERMINAL_TYPES = new Set(['job.completed', 'job.failed', 'job.cancelled', 'job.interrupted']);

export function isTerminalEvent(event: ExecutionEvent): boolean {
  return TERMINAL_TYPES.has(event.type);
}

/** A run row is written just after `POST /pipeline/runs` returns. */
const NOT_FOUND_RETRIES = 5;
const NOT_FOUND_DELAY_MS = 1_500;
const STREAM_FAILURES_BEFORE_POLLING = 3;
const RECONNECT_BASE_MS = 1_000;
const POLL_MIN_MS = 4_000;
const POLL_MAX_MS = 20_000;

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const finish = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish);
  });
}

function statusOf(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const { status } = error as { status?: unknown };
    return typeof status === 'number' ? status : undefined;
  }
  return undefined;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'The request failed';
}

/** Starts the feed and returns its stop function. */
export function startExecutionFeed(
  deps: ExecutionFeedDeps,
  onChange: (state: ExecutionFeedState) => void,
): () => void {
  const controller = new AbortController();
  const { signal } = controller;
  const sleep = deps.sleep ?? defaultSleep;
  // Read through a function: TS would otherwise keep the property narrowed across awaits.
  const stopped = (): boolean => signal.aborted;
  let state = INITIAL_FEED_STATE;
  let terminalSeen = false;

  const update = (patch: Partial<ExecutionFeedState>): void => {
    if (stopped()) return;
    state = { ...state, ...patch };
    onChange(state);
  };

  const lastSeq = (): number => state.events.at(-1)?.seq ?? 0;

  /** Seq is the identity: a replay after a reconnect must not double anything. */
  const merge = (incoming: ExecutionEvent[]): number => {
    const known = new Set(state.events.map((event) => event.seq));
    const fresh = incoming.filter((event) => !known.has(event.seq));
    if (fresh.length === 0) return 0;
    if (fresh.some(isTerminalEvent)) terminalSeen = true;
    update({ events: [...state.events, ...fresh].sort((a, b) => a.seq - b.seq) });
    return fresh.length;
  };

  const finish = (endReason: ExecutionStreamEnd['reason'] | null): void => {
    update({ connection: 'ended', endReason, error: null });
  };

  /** What the server wrote between its last frame and closing. */
  const catchUp = async (): Promise<void> => {
    try {
      merge(await deps.fetchEvents(lastSeq()));
    } catch {
      // The timeline already holds everything the stream delivered.
    }
  };

  const loadHistory = async (): Promise<boolean> => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        merge(await deps.fetchEvents(0));
        update({ historyLoaded: true, error: null });
        return true;
      } catch (error) {
        if (stopped()) return false;
        if (statusOf(error) === 404 && attempt < NOT_FOUND_RETRIES) {
          await sleep(NOT_FOUND_DELAY_MS, signal);
          if (stopped()) return false;
          continue;
        }
        update({ connection: 'error', error: messageOf(error) });
        return false;
      }
    }
  };

  // Read through a function: inside one async body TS would keep the flag narrowed.
  const sawTerminal = (): boolean => terminalSeen;

  const poll = async (): Promise<void> => {
    let delay = POLL_MIN_MS;
    update({ connection: 'polling' });
    while (!stopped()) {
      await sleep(delay, signal);
      if (stopped()) return;
      try {
        const fresh = merge(await deps.fetchEvents(lastSeq()));
        update({ error: null });
        if (sawTerminal()) {
          finish('terminal-event');
          return;
        }
        if (fresh > 0) {
          delay = POLL_MIN_MS;
          continue;
        }
        if (await deps.isJobSettled()) {
          await catchUp();
          finish('job-settled');
          return;
        }
      } catch (error) {
        update({ error: messageOf(error) });
      }
      delay = Math.min(delay * 1.5, POLL_MAX_MS);
    }
  };

  const stream = async (): Promise<void> => {
    let failures = 0;
    let notFound = 0;
    for (;;) {
      const before = lastSeq();
      const outcome = await deps.openStream(
        before,
        {
          onOpen: () => {
            update({ connection: 'live', error: null });
          },
          onEvent: (event) => {
            merge([event]);
          },
        },
        signal,
      );
      if (stopped() || outcome.kind === 'aborted') return;
      if (outcome.kind === 'ended') {
        await catchUp();
        finish(outcome.end.reason);
        return;
      }
      if (sawTerminal()) {
        await catchUp();
        finish('terminal-event');
        return;
      }
      if (outcome.kind === 'unsupported') {
        await poll();
        return;
      }
      if (outcome.kind === 'http-error' && outcome.status === 404) {
        notFound += 1;
        if (notFound > NOT_FOUND_RETRIES) {
          update({ connection: 'error', error: 'The server has no record of this job.' });
          return;
        }
        await sleep(NOT_FOUND_DELAY_MS, signal);
        if (stopped()) return;
        continue;
      }
      if (outcome.kind === 'http-error' && outcome.status === 401) {
        // An expired access token: this request goes through the refresh flow,
        // which the stream's own `fetch` cannot, and collects anything missed.
        await catchUp();
      }
      failures = lastSeq() > before ? 0 : failures + 1;
      if (failures >= STREAM_FAILURES_BEFORE_POLLING) {
        await poll();
        return;
      }
      update({ connection: 'reconnecting' });
      await sleep(RECONNECT_BASE_MS * 2 ** Math.max(failures - 1, 0), signal);
      if (stopped()) return;
    }
  };

  onChange(state);
  void (async () => {
    if (!(await loadHistory())) return;
    if (sawTerminal()) {
      finish('terminal-event');
      return;
    }
    update({ connection: 'connecting' });
    await stream();
  })();

  return () => {
    controller.abort();
  };
}
