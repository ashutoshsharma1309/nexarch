/**
 * Time limits that count only the time this machine was awake.
 *
 * A timer keeps counting through a laptop's sleep. A verification that started
 * 25 seconds before an idle sleep was reported as "timed out after 22 minutes"
 * eight seconds after the lid opened, having been given no working time at all
 * and having recorded every check as blocked. A deadline exists to stop work
 * that is stuck, and a suspended machine is not stuck work.
 *
 * Sleep cannot be observed directly, so it is inferred: a poll that normally
 * returns within a second and instead comes back much later means the process
 * was not running for that gap. The gap is measured and kept, so a caller can
 * say that it happened rather than silently stretching its limit.
 */
const SUSPEND_GAP_MS = 30_000;
const MAX_TICK_MS = 1_000;
const MIN_TICK_MS = 5;

export class AwakeStopwatch {
  private awake = 0;
  private suspended = 0;
  private last: number;

  constructor(private readonly now: () => number = Date.now) {
    this.last = now();
  }

  /** Milliseconds of awake time so far. Call it at least every few seconds. */
  read(): number {
    const current = this.now();
    const delta = current - this.last;
    this.last = current;
    if (delta > SUSPEND_GAP_MS) this.suspended += delta;
    // A clock set backwards is not negative work.
    else if (delta > 0) this.awake += delta;
    return this.awake;
  }

  suspendedMs(): number {
    return this.suspended;
  }
}

export interface AwakeTimer {
  stop: () => void;
  /** How long the machine was away while this timer ran. */
  suspendedMs: () => number;
}

/** Calls `onExpire` once `budgetMs` of awake time has passed. */
export function startAwakeTimer(
  budgetMs: number,
  onExpire: () => void,
  now: () => number = Date.now,
): AwakeTimer {
  const watch = new AwakeStopwatch(now);
  const tickMs = Math.max(MIN_TICK_MS, Math.min(MAX_TICK_MS, Math.floor(budgetMs / 4)));
  const interval = setInterval(() => {
    if (watch.read() < budgetMs) return;
    clearInterval(interval);
    onExpire();
  }, tickMs);
  interval.unref();
  return {
    stop: () => {
      clearInterval(interval);
    },
    suspendedMs: () => watch.suspendedMs(),
  };
}
