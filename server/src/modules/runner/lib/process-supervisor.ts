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
import { forgetChild, noteChild } from './orphan-reaper.js';
import { isPortAnswering } from './port-scanner.js';
import type { LogBuffer } from './log-buffer.js';

const READY_POLL_MS = 500;
const READY_TIMEOUT_MS = 120_000;
const INSTALL_TIMEOUT_MS = 5 * 60_000;

/** Every live child, so one exit hook can sweep them all. */
const liveChildren = new Set<ChildProcess>();

/**
 * Kill a child *and everything it started*.
 *
 * The command we spawn is `npm run dev`; the thing that actually holds the
 * port is the `tsx` or `vite` process npm forks. Signalling only the pid we
 * own kills the wrapper and leaves the grandchild alive, reparented to init,
 * still bound to its port with nothing left that knows how to stop it — the
 * exact orphans found holding ports 5175-5179. Spawning `detached` puts each
 * child at the head of its own process group, so negating the pid signals the
 * whole group and the generated app dies with its supervisor.
 */
function killGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  const pid = child.pid;
  if (pid === undefined) return;
  try {
    // Negative pid = the process group. Falls back to the single process if
    // the group is already gone (ESRCH) or groups are unavailable (Windows).
    process.kill(-pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // already gone
    }
  }
}

function sweep(): void {
  for (const child of liveChildren) {
    killGroup(child, 'SIGKILL');
  }
  liveChildren.clear();
}

process.on('exit', sweep);

// `exit` alone is not enough. A signalled shutdown (Ctrl-C, a watcher
// restarting the dev server, an orchestrator stopping the container) drains
// HTTP connections first, and if that outlives the grace period the process
// is killed without ever emitting `exit` — leaving a generated app's dev
// servers holding their ports with nothing left to stop them. Sweeping on
// the signal itself makes the guarantee unconditional: no preview outlives
// the NexArch process that started it.
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
  process.on(signal, sweep);
}

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

/**
 * `npm install` is the heaviest thing NexArch spawns — hundreds of MB of
 * resident memory and a lock on the shared npm cache. A preview and an agent
 * run's validation install the *same* generated project at the same moment,
 * and on a small machine two at once is what tips it into swap: timers fire
 * minutes late, installs crawl, and both sessions time out. Installs
 * therefore take turns; the second one also finds a warm cache
 * (`--prefer-offline`) and finishes in seconds rather than minutes.
 */
function maxConcurrentInstalls(): number {
  const parsed = Number.parseInt(process.env.NEXARCH_RUNNER_MAX_INSTALLS ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

let activeInstalls = 0;
const waitingInstalls: (() => void)[] = [];

async function acquireInstallSlot(): Promise<() => void> {
  if (activeInstalls >= maxConcurrentInstalls()) {
    await new Promise<void>((resolve) => {
      waitingInstalls.push(resolve);
    });
  }
  activeInstalls += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeInstalls -= 1;
    waitingInstalls.shift()?.();
  };
}

function isInstall(command: string, args: readonly string[]): boolean {
  return command === 'npm' && (args[0] === 'install' || args[0] === 'ci');
}

/** Run an install/configure-style command to completion. Resolves with the exit code. */
export async function runToCompletion(
  command: string,
  args: string[],
  cwd: string,
  stream: 'backend' | 'frontend',
  logs: LogBuffer,
  env: Record<string, string> = {},
): Promise<number> {
  if (!isInstall(command, args)) return spawnToCompletion(command, args, cwd, stream, logs, env);

  if (activeInstalls >= maxConcurrentInstalls()) {
    logs.append('system', `${stream}: waiting for another install to finish`);
  }
  const release = await acquireInstallSlot();
  try {
    const installArgs = args.includes('--prefer-offline') ? args : [...args, '--prefer-offline'];
    return await spawnToCompletion(command, installArgs, cwd, stream, logs, env);
  } finally {
    release();
  }
}

function spawnToCompletion(
  command: string,
  args: string[],
  cwd: string,
  stream: 'backend' | 'frontend',
  logs: LogBuffer,
  env: Record<string, string>,
): Promise<number> {
  return new Promise((resolve) => {
    // Whitelisted environment: children never see NexArch's own secrets
    // (see child-env.ts for why inheriting DATABASE_URL is catastrophic).
    const child = spawn(command, args, { cwd, shell: false, env: childEnv(env), detached: true });
    track(child);
    wire(child, stream, logs);

    const timer = setTimeout(() => {
      logs.append(
        'system',
        `${stream} install exceeded ${String(INSTALL_TIMEOUT_MS / 60000)} minutes — terminating`,
      );
      killGroup(child, 'SIGTERM');
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
    detached: true,
  });
  track(child);
  wire(child, stream, logs);

  // Written down before anything else can go wrong: if NexArch is SIGKILLed
  // the note is the only remaining trace of this dev server, and the next
  // boot uses it to stop the process instead of leaving the port bound.
  if (child.pid !== undefined) noteChild(child.pid, cwd, `${command} ${args.join(' ')}`);

  child.once('error', (error) => {
    if (child.pid !== undefined) forgetChild(child.pid);
    logs.append('system', `${stream}: failed to spawn ${command}: ${error.message}`);
    onExit(127);
  });
  child.once('exit', (code) => {
    if (child.pid !== undefined) forgetChild(child.pid);
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
  killGroup(child, 'SIGTERM');
  // Escalate if SIGTERM is ignored — dev servers occasionally trap it.
  const timer = setTimeout(() => {
    killGroup(child, 'SIGKILL');
  }, 5_000);
  timer.unref();
}
