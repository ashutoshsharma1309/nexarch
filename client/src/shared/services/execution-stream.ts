/**
 * The execution SSE stream, read with `fetch`.
 *
 * Native `EventSource` cannot say why it failed, and an access token expiring
 * mid-build looks exactly like a network fault to it. Reading the response
 * ourselves exposes the status, so a 401 can go through the app's refresh flow
 * and a 404 in the first moments of a job can be retried.
 */
import { apiClient } from './api-client';
import type { ExecutionEvent, ExecutionStreamEnd } from '@/shared/types/execution';

export interface SseFrame {
  event: string;
  data: string;
  id: string | null;
}

/** Feeds text in as it arrives and calls back once per complete frame. */
export function createSseParser(onFrame: (frame: SseFrame) => void): (chunk: string) => void {
  let buffer = '';
  let event = '';
  let id: string | null = null;
  let data: string[] = [];

  const dispatch = (): void => {
    // Comment-only blocks (the heartbeat) and `retry:` carry no data to deliver.
    if (data.length > 0) onFrame({ event: event || 'message', data: data.join('\n'), id });
    event = '';
    id = null;
    data = [];
  };

  const readLine = (line: string): void => {
    if (line === '') {
      dispatch();
      return;
    }
    if (line.startsWith(':')) return;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const raw = colon === -1 ? '' : line.slice(colon + 1);
    const value = raw.startsWith(' ') ? raw.slice(1) : raw;
    if (field === 'event') event = value;
    else if (field === 'id') id = value;
    else if (field === 'data') data.push(value);
  };

  return (chunk) => {
    buffer += chunk;
    let start = 0;
    for (;;) {
      const end = buffer.indexOf('\n', start);
      if (end === -1) break;
      const line = buffer.slice(start, end);
      readLine(line.endsWith('\r') ? line.slice(0, -1) : line);
      start = end + 1;
    }
    buffer = buffer.slice(start);
  };
}

export type StreamOutcome =
  | { kind: 'ended'; end: ExecutionStreamEnd }
  /** The connection finished without the server's `end` frame: resume from the last seq. */
  | { kind: 'closed' }
  | { kind: 'http-error'; status: number }
  | { kind: 'network-error' }
  /** This browser cannot read a response body as it arrives. */
  | { kind: 'unsupported' }
  | { kind: 'aborted' };

export interface OpenStreamOptions {
  projectId: string;
  jobId: string;
  afterSeq: number;
  signal: AbortSignal;
  onOpen: () => void;
  onEvent: (event: ExecutionEvent) => void;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function openExecutionStream(options: OpenStreamOptions): Promise<StreamOutcome> {
  const { projectId, jobId, afterSeq, signal, onOpen, onEvent } = options;
  const base = apiClient.defaults.baseURL ?? '/api/v1';
  const url = `${base}/projects/${projectId}/executions/${jobId}/stream?after=${String(afterSeq)}`;
  // Both forms name the same position; the server prefers the header.
  const headers: Record<string, string> = {
    Accept: 'text/event-stream',
    'Last-Event-ID': String(afterSeq),
  };

  try {
    const response = await fetch(url, { credentials: 'include', headers, signal });
    if (!response.ok) return { kind: 'http-error', status: response.status };
    const reader = response.body?.getReader();
    if (!reader) return { kind: 'unsupported' };
    onOpen();

    // Held in an object: a `let` assigned inside the callback would narrow to null below.
    const closing: { end: ExecutionStreamEnd | null } = { end: null };
    const parse = createSseParser((frame) => {
      if (frame.event === 'execution') {
        const event = parseJson(frame.data) as ExecutionEvent | null;
        if (event) onEvent(event);
      } else if (frame.event === 'end') {
        closing.end = parseJson(frame.data) as ExecutionStreamEnd | null;
      }
    });

    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parse(decoder.decode(value, { stream: true }));
    }
    return closing.end ? { kind: 'ended', end: closing.end } : { kind: 'closed' };
  } catch {
    return signal.aborted ? { kind: 'aborted' } : { kind: 'network-error' };
  }
}
