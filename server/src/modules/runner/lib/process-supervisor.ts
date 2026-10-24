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
import { readFile, stat } from 'node:fs/promises';

import { childEnv } from './child-env.js';
import { forgetChild, noteChild } from './orphan-reaper.js';
import { isPortAnswering } from './port-scanner.js';
import type { LogBuffer } from './log-buffer.js';

const READY_POLL_MS = 500;
const READY_TIMEOUT_MS = 120_000;
/**
 * Deadline for every run-to-completion spawn — install, `prisma generate`,
 * `prisma db push`, and the build/typecheck/lint commands the validation
 * mesh runs through here. It always covered all of them; the name and the
 * log line said "install", which is the kind of detail that gets a deadline
 * removed from a path it was protecting.
 */
const COMMAND_TIMEOUT_MS = 5 * 60_000;
/** How long a terminated child gets to exit on its own before SIGKILL. */
const KILL_GRACE_MS = 5_000;

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

async function acquireInstallSlot(signal: AbortSignal | undefined): Promise<() => void> {
  if (activeInstalls >= maxConcurrentInstalls()) {
    await new Promise<void>((resolve) => {
      const wake = (): void => {
        // Leave the queue on the way out, whichever woke us. A cancelled
        // waiter that stayed in the array would be handed the slot by the
        // next release and resolve into nothing — with one slot by default,
        // that strands every later install for the life of the process.
        const queued = waitingInstalls.indexOf(wake);
        if (queued >= 0) waitingInstalls.splice(queued, 1);
        signal?.removeEventListener('abort', wake);
        resolve();
      };
      waitingInstalls.push(wake);
      // A stopped session must stop waiting for a slot it will never use.
      signal?.addEventListener('abort', wake, { once: true });
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

/**
 * Packages whose platform-specific binary is declared *optional*, and which
 * the generated frontend cannot start without.
 */
const NATIVE_HOSTS = ['rollup', 'esbuild', '@tailwindcss/oxide', 'lightningcss'];

/**
 * A registry package name npm can safely be handed as an argument, and a
 * version that is a version rather than a location.
 *
 * The `optionalDependencies` map below is read out of a *generated*
 * project's node_modules, so both halves are attacker-chosen text about to
 * become argv for `npm install`. `shell: false` stops it being read as
 * shell syntax but not as npm syntax: a name beginning with `-` arrives as
 * a flag, and a version of `https://…/pkg.tgz`, `file:/…` or `git+ssh://…`
 * makes npm fetch and run code from somewhere nobody chose. Repair only
 * what looks like the registry package the host declared.
 */
const REGISTRY_PACKAGE_NAME = /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/;
const PLAIN_VERSION = /^[~^]?\d[\w.+-]*$/;

interface HostManifest {
  optionalDependencies?: Record<string, string>;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reinstall platform binaries that npm quietly skipped.
 *
 * npm treats a failed *optional* dependency as success: if the fetch of
 * `@rollup/rollup-darwin-arm64` fails — a flaky network, a cache entry the
 * last killed install left half-written — the install still exits 0 and the
 * missing binary only surfaces minutes later, when vite dies at startup with
 * "Cannot find module @rollup/rollup-darwin-arm64" (npm/cli#4828). The whole
 * preview is wasted on a fault that was visible the moment install finished.
 *
 * So check for it here, while it is still cheap to fix, and fetch the binary
 * by name. Repairing is best-effort: if it cannot be fixed the run continues
 * and fails where it would have anyway, with the log saying why.
 */
export async function missingNativeBinaries(
  cwd: string,
  // `darwin-arm64`, `linux-x64` — the token every such package name carries.
  token = `${process.platform}-${process.arch}`,
): Promise<{ name: string; version: string }[]> {
  const missing: { name: string; version: string }[] = [];

  for (const host of NATIVE_HOSTS) {
    let manifest: HostManifest;
    try {
      manifest = JSON.parse(
        await readFile(`${cwd}/node_modules/${host}/package.json`, 'utf8'),
      ) as HostManifest;
    } catch {
      continue; // Not installed here — nothing this host needs.
    }

    for (const [name, version] of Object.entries(manifest.optionalDependencies ?? {})) {
      if (!name.includes(token)) continue;
      if (!REGISTRY_PACKAGE_NAME.test(name) || !PLAIN_VERSION.test(version)) continue;
      if (await exists(`${cwd}/node_modules/${name}`)) continue;
      missing.push({ name, version });
    }
  }
  return missing;
}

async function repairSkippedNativeBinaries(
  cwd: string,
  stream: 'backend' | 'frontend',
  logs: LogBuffer,
  env: Record<string, string>,
  signal: AbortSignal | undefined,
): Promise<void> {
  for (const { name, version } of await missingNativeBinaries(cwd)) {
    logs.append(
      'system',
      `${stream}: ${name} was skipped by npm (optional dependency) — installing it directly`,
    );
    // No --prefer-offline: the cache is the likeliest reason it is missing.
    const code = await spawnToCompletion(
      'npm',
      ['install', `${name}@${version}`, '--no-save', '--no-audit', '--no-fund'],
      cwd,
      stream,
      logs,
      env,
      signal,
    );
    if (code !== 0) {
      logs.append(
        'system',
        `${stream}: could not install ${name} (code ${String(code)}) — the app may fail to start`,
      );
    }
  }
}

/**
 * Run an install/configure-style command to completion. Resolves with the
 * exit code.
 *
 * `signal` is the session's cancellation: aborting it kills the command's
 * whole process group. Without it, stopping a session during install left
 * `npm install` running for up to the command timeout against a workspace
 * the caller had already given up on — a stop that did not stop, holding
 * the single install slot while the next run queued behind it.
 */
export async function runToCompletion(
  command: string,
  args: string[],
  cwd: string,
  stream: 'backend' | 'frontend',
  logs: LogBuffer,
  env: Record<string, string> = {},
  signal?: AbortSignal,
): Promise<number> {
  if (!isInstall(command, args)) {
    return spawnToCompletion(command, args, cwd, stream, logs, env, signal);
  }

  if (activeInstalls >= maxConcurrentInstalls()) {
    logs.append('system', `${stream}: waiting for another install to finish`);
  }
  const release = await acquireInstallSlot(signal);
  try {
    const installArgs = args.includes('--prefer-offline') ? args : [...args, '--prefer-offline'];
    const code = await spawnToCompletion(command, installArgs, cwd, stream, logs, env, signal);
    if (code === 0) await repairSkippedNativeBinaries(cwd, stream, logs, env, signal);
    return code;
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
  signal: AbortSignal | undefined,
): Promise<number> {
  return new Promise((resolve) => {
    // Cancelled before it got a turn (the install queue can hold a command
    // for minutes): never spawn it. 130 is the shell's "killed by SIGINT",
    // and every caller re-checks cancellation before reading the code.
    if (signal?.aborted === true) {
      resolve(130);
      return;
    }

    // Whitelisted environment: children never see NexArch's own secrets
    // (see child-env.ts for why inheriting DATABASE_URL is catastrophic).
    const child = spawn(command, args, { cwd, shell: false, env: childEnv(env), detached: true });
    track(child);
    wire(child, stream, logs);

    const timer = setTimeout(() => {
      logs.append(
        'system',
        `${stream}: ${command} exceeded ${String(COMMAND_TIMEOUT_MS / 60_000)} minutes — terminating`,
      );
      // stopChild, not a bare SIGTERM: npm forwards signals unevenly, and a
      // child that ignores the one signal this timeout used to send keeps
      // running past its own deadline with this promise never settling — so
      // the install slot it holds is never released and every later run
      // queues behind it. The escalation is what makes the deadline real.
      stopChild(child);
    }, COMMAND_TIMEOUT_MS);
    timer.unref();

    const onAbort = (): void => {
      logs.append('system', `${stream}: ${command} cancelled — terminating`);
      stopChild(child);
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    const settle = (code: number): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve(code);
    };

    child.once('error', (error) => {
      logs.append('system', `${stream}: failed to spawn ${command}: ${error.message}`);
      settle(127);
    });
    child.once('exit', (code) => {
      settle(code ?? 1);
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

/**
 * The one way a child is terminated: ask the whole group, then insist.
 * Every caller — stop, restart, failure, timeout, cancellation — goes
 * through here, so there is no path that sends a SIGTERM a trapping dev
 * server can simply ignore while keeping its port.
 */
export function stopChild(child: ChildProcess): void {
  killGroup(child, 'SIGTERM');
  // Escalate if SIGTERM is ignored — dev servers occasionally trap it.
  const timer = setTimeout(() => {
    killGroup(child, 'SIGKILL');
  }, KILL_GRACE_MS);
  timer.unref();
}
