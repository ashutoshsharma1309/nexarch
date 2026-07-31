/**
 * Bounded per-session log store with cursor-based reads. A ring buffer
 * (not an unbounded array) because a chatty dev server can log forever;
 * monotonic sequence numbers survive eviction, so a client that polls
 * `after=cursor` never sees duplicates and can detect gaps.
 */
import type { LogStream, RunLogChunk, RunLogLine } from '../runner.types.js';

const MAX_LINES = 2_000;
const MAX_LINE_LENGTH = 4_000;

export class LogBuffer {
  private lines: RunLogLine[] = [];
  private nextSeq = 1;

  append(stream: LogStream, raw: string): void {
    // Split multi-line chunks so cursors advance per printed line.
    for (const piece of raw.split(/\r?\n/)) {
      const line = piece.trimEnd();
      if (line.length === 0) continue;
      this.lines.push({
        seq: this.nextSeq,
        stream,
        line: line.length > MAX_LINE_LENGTH ? `${line.slice(0, MAX_LINE_LENGTH)}…` : line,
        at: new Date().toISOString(),
      });
      this.nextSeq += 1;
    }
    if (this.lines.length > MAX_LINES) {
      this.lines = this.lines.slice(this.lines.length - MAX_LINES);
    }
  }

  read(after: number): RunLogChunk {
    const lines = this.lines.filter((entry) => entry.seq > after);
    const last = lines[lines.length - 1] ?? this.lines[this.lines.length - 1];
    return { lines, nextCursor: last?.seq ?? after };
  }

  /** The last stderr-ish context for failure diagnostics. */
  tail(count: number): string[] {
    return this.lines.slice(-count).map((entry) => `[${entry.stream}] ${entry.line}`);
  }
}
