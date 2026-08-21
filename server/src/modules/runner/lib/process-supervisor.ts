/**
 * Child-process supervision: spawn, watch, kill — nothing else. Every
 * child is tracked in a module-level registry with a single process-exit
 * sweep so no dev server outlives NexArch, and every spawn goes through
 * `shell: false` with an argv array — commands come from the plan, never
 * concatenated into a shell string. A child failing NEVER throws into the
 * platform's request path; outcomes are reported through callbacks.
 */
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

import { childEnv } from './child-env.js';
import { isPortAnswering } from './port-scanner.js';
import type { LogBuffer } from './log-buffer.js';

const READY_POLL_MS = 500;
const READY_TIMEOUT_MS = 120_000;
const INSTALL_TIMEOUT_MS = 5 * 60_000;

/** Every live child, so one exit hook can sweep them all. */
const liveChildren = new Set<ChildProcess>();

process.on('exit', () => {
  for (const child of liveChildren) {
    try {
      child.kill('SIGKILL');
    } catch {
      // already gone
    }
  }
});

function track(child: ChildProcess): void {
  liveChildren.add(child);
  child.once('exit', () => {
    liveChildren.delete(child);
  });
}

function wire(
  child: ChildProcess,
  stream: 'backend' | 'frontend' | 'system',
  logs: LogBuffer,
): void {
  child.stdout?.on('data', (chunk: Buffer) => {
    logs.append(stream, chunk.toString('utf8'));
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    logs.append(stream, chunk.toString('utf8'));
  });
}

/** Run an install/configure-style command to completion. Resolves with the exit code. */
export function runToCompletion(
  command: string,
  args: string[],
  cwd: string,
  stream: 'backend' | 'frontend',
  logs: LogBuffer,
  env: Record<string, string> = {},
): Promise<number> {
  return new Promise((resolve) => {
    // Whitelisted environment: children never see NexArch's own secrets
    // (see child-env.ts for why inheriting DATABASE_URL is catastrophic).
    const child = spawn(command, args, { cwd, shell: false, env: childEnv(env) });
    track(child);
    wire(child, stream, logs);

    const timer = setTimeout(() => {
      logs.append(
        'system',
        `${stream} install exceeded ${String(INSTALL_TIMEOUT_MS / 60000)} minutes — terminating`,
      );
      child.kill('SIGTERM');
    }, INSTALL_TIMEOUT_MS);
    timer.unref();

    child.once('error', (error) => {
      clearTimeout(timer);
      logs.append('system', `${stream}: failed to spawn ${command}: ${error.message}`);
      resolve(127);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code ?? 1);
    });
  });
}

export interface StartedProcess {
  child: ChildProcess;
  pid: number | null;
}

/** Spawn a long-running dev server; exit is reported via callback, never thrown. */
export function startProcess(
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
  stream: 'backend' | 'frontend',
  logs: LogBuffer,
  onExit: (code: number | null) => void,
): StartedProcess {
  const child = spawn(command, args, {
    cwd,
    shell: false,
    env: childEnv(env),
  });
  track(child);
  wire(child, stream, logs);

  child.once('error', (error) => {
    logs.append('system', `${stream}: failed to spawn ${command}: ${error.message}`);
    onExit(127);
  });
  child.once('exit', (code) => {
    onExit(code);
  });

  return { child, pid: child.pid ?? null };
}

/** Resolve true once the port answers, false if the deadline passes or the probe is cancelled. */
export async function waitUntilAnswering(
  port: number,
  isCancelled: () => boolean,
): Promise<boolean> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (isCancelled()) return false;
    if (await isPortAnswering(port)) return true;
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
  }
  return false;
}

/**
 * True once an HTTP GET on the path answers with any 2xx-4xx status. A
 * TCP accept only proves a socket exists; RUNNING must mean the HTTP layer
 * actually serves. 4xx still counts as alive — a dev server answering 404
 * on / is up; only "no HTTP response at all" means not ready.
 */
export async function waitUntilHealthy(
  port: number,
  path: string,
  isCancelled: () => boolean,
): Promise<boolean> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (isCancelled()) return false;
    try {
      // `localhost`, not 127.0.0.1 — fetch tries both address families, and
      // dev servers on some setups bind ::1 only.
      const response = await fetch(`http://localhost:${String(port)}${path}`, {
        signal: AbortSignal.timeout(2_000),
        redirect: 'manual',
      });
      if (response.status < 500) return true;
    } catch {
      // not answering yet
    }
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
  }
  return false;
}

export function stopChild(child: ChildProcess): void {
  try {
    child.kill('SIGTERM');
    // Escalate if SIGTERM is ignored — dev servers occasionally trap it.
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // already gone
      }
    }, 5_000);
    timer.unref();
  } catch {
    // already gone
  }
}
