import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSseParser, openExecutionStream } from './execution-stream';
import type { SseFrame } from './execution-stream';
import type { ExecutionEvent } from '@/shared/types/execution';

function frames(...chunks: string[]): SseFrame[] {
  const out: SseFrame[] = [];
  const parse = createSseParser((frame) => out.push(frame));
  chunks.forEach(parse);
  return out;
}

function streamResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  let index = 0;
  return {
    ok: status >= 200 && status < 300,
    status,
    body: {
      getReader: () => ({
        read: () => {
          const chunk = chunks[index];
          index += 1;
          return Promise.resolve(
            chunk === undefined
              ? { done: true, value: undefined }
              : { done: false, value: encoder.encode(chunk) },
          );
        },
      }),
    },
  } as unknown as Response;
}

const event = { seq: 7, type: 'note', message: 'hello' } as ExecutionEvent;
const eventFrame = `id: 7\nevent: execution\ndata: ${JSON.stringify(event)}\n\n`;

function open(afterSeq = 6) {
  const onOpen = vi.fn();
  const onEvent = vi.fn();
  const result = openExecutionStream({
    projectId: 'p1',
    jobId: 'j1',
    afterSeq,
    signal: new AbortController().signal,
    onOpen,
    onEvent,
  });
  return { result, onOpen, onEvent };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createSseParser', () => {
  it('reassembles a frame split across chunks', () => {
    expect(frames('id: 3\nevent: exec', 'ution\ndata: {"a"', ':1}\n\n')).toEqual([
      { id: '3', event: 'execution', data: '{"a":1}' },
    ]);
  });

  it('ignores heartbeats and the retry directive', () => {
    expect(frames('retry: 3000\n\n: heartbeat\n\n')).toEqual([]);
  });

  it('handles CRLF line endings and multi-line data', () => {
    expect(frames('event: x\r\ndata: a\r\ndata: b\r\n\r\n')).toEqual([
      { id: null, event: 'x', data: 'a\nb' },
    ]);
  });
});

describe('openExecutionStream', () => {
  it('resumes with Last-Event-ID and delivers events until the end frame', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        streamResponse([
          eventFrame,
          'event: end\ndata: {"reason":"terminal-event","lastSeq":7}\n\n',
        ]),
      );
    vi.stubGlobal('fetch', fetchMock);

    const { result, onOpen, onEvent } = open();

    await expect(result).resolves.toEqual({
      kind: 'ended',
      end: { reason: 'terminal-event', lastSeq: 7 },
    });
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onEvent).toHaveBeenCalledWith(event);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/projects/p1/executions/j1/stream?after=6');
    expect(init.credentials).toBe('include');
    expect(init.headers).toMatchObject({ 'Last-Event-ID': '6' });
  });

  it('reports a dropped connection as closed so the caller resumes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamResponse([eventFrame])));
    await expect(open().result).resolves.toEqual({ kind: 'closed' });
  });

  it('exposes the HTTP status, which native EventSource hides', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamResponse([], 401)));
    await expect(open().result).resolves.toEqual({ kind: 'http-error', status: 401 });
  });

  it('turns a network fault into an outcome rather than a rejection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('failed')));
    await expect(open().result).resolves.toEqual({ kind: 'network-error' });
  });
});
