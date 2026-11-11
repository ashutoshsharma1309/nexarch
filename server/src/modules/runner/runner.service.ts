/**
 * Run-session lifecycle. Sessions live in an in-memory registry (the AI
 * Orchestrator's history model); the pipeline runs detached from the
 * request — POST answers with the `preparing` session and the phases
 * advance as the work happens: preparing → installing → starting →
 * running, with stopping/stopped/restarting/failed reachable from the
 * obvious places. Every failure path funnels through `fail()`, which
 * attaches human diagnostics from the log tail — a session dies with an
 * explanation, and the platform process never dies with it.
 *
 * SECURITY, stated plainly: there is NO isolation boundary here. A
 * generated project is model-written code, and this module installs its
 * dependencies and runs its dev servers as ordinary child processes with
 * the full privileges of the developer running NexArch — same user, same
 * home directory, same ssh keys, same network, same disk. `npm install`
 * alone executes whatever the generated `package.json` put in its
 * lifecycle scripts, and `npm run dev` executes the script body itself;
 * neither is sandboxed, rate-limited or confined to the workspace.
 *
 * What the runner does provide is defence in depth around that fact, and
 * nothing more: writes are confined to the run workspace by path and by
 * realpath (`workspace-writer.ts`), children get a whitelisted environment
 * with none of the platform's secrets (`child-env.ts`), every spawn is an
 * explicit executable plus an argv array with `shell: false`, every
 * command has a deadline and dies as a process group, and the one
 * recursive delete proves its target is inside the run root. None of that
 * stops a generated app from reading the developer's files, spending their
 * network, forking without bound or filling the disk. Docker is not
 * available on the target machine and macOS `sandbox-exec` is deprecated
 * and unverified here, so no such claim is made: do not call this
 * sandboxed.
 */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { logger } from '../../shared/logger/index.js';
import { withLogContext } from '../../shared/logger/context.js';
import { logEvent } from '../../shared/logger/events.js';
import { AppError } from '../../shared/utils/app-error.js';
import { slugify } from '../../shared/utils/strings.js';
import { planRun, portPreferenceFor } from './lib/command-planner.js';
import { NO_DATABASE_HINT, planProvisioning } from './lib/database-provisioner.js';
import { diagnose } from './lib/diagnostics.js';
import { LogBuffer } from './lib/log-buffer.js';
import { findFreePort, releasePort } from './lib/port-scanner.js';
import {
  checkProjectPolicy,
  describeViolations,
  INSTALL_SCRIPT_PACKAGES,
} from './lib/script-policy.js';
import {
  runToCompletion,
  startProcess,
  stopChild,
  waitUntilAnswering,
  waitUntilHealthy,
} from './lib/process-supervisor.js';
import { ensureEnvFile, writeWorkspace } from './lib/workspace-writer.js';
import type { ChildProcess } from 'node:child_process';
import type {
  CreateSessionRequest,
  ProcessKind,
  RunLogChunk,
  RunPhase,
  RunPlan,
  RunProcess,
  RunSession,
} from './runner.types.js';

interface SessionRuntime {
  session: RunSession;
  /**
   * The user who created the session. A run writes files and spawns
   * processes, so a session must never be visible to — or controllable by —
   * anyone but its owner (Phase 16). Kept on the private runtime, not the
   * public RunSession, so the wire shape and its tests are unchanged.
   */
  ownerId: string;
  logs: LogBuffer;
  children: Map<ProcessKind, ChildProcess>;
  plan: RunPlan;
  cancelled: boolean;
  /**
   * Cancellation for the run-to-completion commands (install, prisma).
   * `cancelled` is only read *between* awaits, so on its own a stop left
   * the running `npm install` to finish minutes later — against a
   * workspace nobody was waiting for, holding the one install slot. The
   * abort kills that command's process group instead.
   */
  abort: AbortController;
}

const ACTIVE_PHASES: RunPhase[] = [
  'preparing',
  'installing',
  'configuring',
  'starting',
  'running',
  'restarting',
];
const MAX_SESSIONS = 30;

const sessions = new Map<string, SessionRuntime>();

/**
 * Owner tag for runner sessions the platform creates for itself — the
 * validation mesh spins up a session to build and probe a generated project.
 * These are internal and never surfaced through the runner HTTP routes; the
 * tag is not a real user id, so no authenticated caller can ever list or
 * control them. Using one consistent tag keeps their ownership self-consistent
 * across create/poll/stop without threading a user through the validators.
 */
export const INTERNAL_RUNNER_OWNER = '@nexarch/internal-validation';

/** Owner tag for build verification, so its admission budget is its own. */
export const INTERNAL_VERIFY_OWNER = '@nexarch/build-verification';

/**
 * Tags that all mean "the platform itself".
 *
 * The project editor stops the sessions `validateRuntime` created under a tag
 * of its own, and the mismatch used to come back as not-found, which the
 * caller swallowed: the edit's preview kept its ports and processes for the
 * life of the server. One platform caller may stop what another started;
 * nothing here extends that to a real user, whose id is never one of these.
 */
const PLATFORM_OWNERS: ReadonlySet<string> = new Set([
  INTERNAL_RUNNER_OWNER,
  INTERNAL_VERIFY_OWNER,
  'internal:project-editor',
]);

function sameOwner(sessionOwner: string, caller: string): boolean {
  if (sessionOwner === caller) return true;
  return PLATFORM_OWNERS.has(sessionOwner) && PLATFORM_OWNERS.has(caller);
}

/** Stops a platform-owned session, whichever internal caller started it. */
export function stopInternalSession(id: string): RunSession {
  return stopSession(id, INTERNAL_RUNNER_OWNER);
}

/**
 * Read through a call boundary: `cancelled` is flipped concurrently by
 * stop/restart while the pipeline awaits, which TS's flow narrowing
 * cannot see — direct property checks get narrowed to "always false".
 */
function isCancelled(runtime: SessionRuntime): boolean {
  return runtime.cancelled;
}

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** How many runs one owner may have in flight at once. */
function maxActiveSessions(): number {
  // Optional per-deployment knob, same convention as the provider keys.
  return readPositiveInt('NEXARCH_RUNNER_MAX_SESSIONS', 2);
}

/**
 * How many runs the whole machine may have in flight, across every owner.
 *
 * This is a different fact from the per-owner limit and must stay separate.
 * Counting every owner's sessions against one shared budget produced the
 * worst possible failure: the platform's own validation mesh holds sessions
 * under INTERNAL_RUNNER_OWNER, so a user who had just generated a project
 * was refused a preview and told to "stop a session first" while their
 * session list was empty — the sessions filling the budget were ones they
 * could neither see nor stop. A limit may only be enforced over the set the
 * caller can actually act on; anything wider needs its own message.
 */
function maxActiveSessionsTotal(): number {
  return readPositiveInt('NEXARCH_RUNNER_MAX_ACTIVE_TOTAL', maxActiveSessions() * 4);
}

/**
 * Whether another run may start, and if not, what to tell the caller.
 *
 * Pure, and exported, so the rule can be tested without spawning npm — the
 * bug it encodes was only reachable through a live run, which is exactly the
 * kind of rule that needs a test that does not need one.
 */
export function runAdmission(
  active: readonly { ownerId: string; projectName?: string }[],
  ownerId: string,
  perOwnerLimit: number = maxActiveSessions(),
  totalLimit: number = maxActiveSessionsTotal(),
): { allowed: true } | { allowed: false; message: string } {
  const mine = active.filter((entry) => entry.ownerId === ownerId);
  if (mine.length >= perOwnerLimit) {
    // Name them. The slots are almost always held by *other* projects, and
    // the refusal used to say "stop one from the preview page" while the
    // page the user was reading it on showed no run at all — the thing to
    // stop was one project tab away with nothing pointing at it.
    const held = mine
      .map((entry) => entry.projectName)
      .filter((name): name is string => typeof name === 'string' && name.length > 0);
    const which = held.length > 0 ? ` (${held.join(', ')})` : '';
    return {
      allowed: false,
      message: `You already have ${String(mine.length)} run${mine.length === 1 ? '' : 's'} going${which} — stop one below, or raise NEXARCH_RUNNER_MAX_SESSIONS`,
    };
  }
  if (active.length >= totalLimit) {
    // Machine-wide, so name it as such: the caller has nothing to stop.
    return {
      allowed: false,
      message: `This NexArch instance is at its run capacity (${String(active.length)} running) — try again shortly, or raise NEXARCH_RUNNER_MAX_ACTIVE_TOTAL`,
    };
  }
  return { allowed: true };
}

function transition(runtime: SessionRuntime, phase: RunPhase, detail: string): void {
  runtime.session.phase = phase;
  runtime.session.updatedAt = new Date().toISOString();
  runtime.session.transitions.push({ phase, at: runtime.session.updatedAt, detail });
  runtime.logs.append('system', detail);
}

/** Hands the session's ports back to the allocator: bound now, or never will be. */
function releaseSessionPorts(runtime: SessionRuntime): void {
  for (const record of runtime.session.processes) releasePort(record.port);
}

/** What an internal caller can add between configuring and starting. */
export interface SessionHooks {
  /**
   * Runs with dependencies installed and nothing started yet: the point where
   * a project's own typecheck and build can run without a dev server beside
   * them. `signal` fires when the session is stopped.
   */
  beforeStart?: (context: {
    workspaceDir: string;
    signal: AbortSignal;
    targets: RunPlan['targets'];
  }) => Promise<void>;
}

function fail(runtime: SessionRuntime, detail: string, exitCode: number | null): void {
  if (runtime.session.phase === 'failed' || runtime.session.phase === 'stopped') return;
  runtime.session.diagnostics = diagnose(exitCode, runtime.logs.tail(40));
  transition(runtime, 'failed', detail);
  releaseSessionPorts(runtime);
  // Both halves, because a failure can arrive from either: a command still
  // running (one target's install failed while the other's runs on) and the
  // dev servers already started.
  runtime.abort.abort();
  for (const child of runtime.children.values()) stopChild(child);
  runtime.children.clear();
}

function processOf(runtime: SessionRuntime, kind: ProcessKind): RunProcess {
  const record = runtime.session.processes.find((p) => p.kind === kind);
  if (!record) throw AppError.internal(`Session has no ${kind} process record`);
  return record;
}

/**
 * Configure stage: synthesize .env files, then for prisma targets run
 * `prisma generate` and — when a runner database is configured — create
 * the session's own database and push the schema into it. Provisioning
 * failures degrade (the generated backend boots without a database and
 * says so); they never abort the run, because a browsable degraded app
 * plus a precise warning beats a dead session.
 */
async function configureTargets(runtime: SessionRuntime): Promise<boolean> {
  const { plan, session } = runtime;
  transition(runtime, 'configuring', 'Preparing environment and database');

  const provision = planProvisioning(slugify(session.projectName) || 'project');

  for (const target of plan.targets) {
    if (isCancelled(runtime)) return false;
    const cwd = `${session.workspaceDir}/${target.directory}`;

    if (target.envFile) {
      const overrides: Record<string, string> = {};
      if (target.kind === 'backend' && provision) {
        overrides.DATABASE_URL = `"${provision.databaseUrl}"`;
      }
      await ensureEnvFile(
        session.workspaceDir,
        target.envFile.path,
        target.envFile.derivedFrom,
        overrides,
      );
    }

    if (!target.prisma) continue;

    runtime.logs.append('system', `${target.kind}: npx prisma generate`);
    const generateCode = await runToCompletion(
      'npx',
      ['prisma', 'generate'],
      cwd,
      target.kind,
      runtime.logs,
      {},
      runtime.abort.signal,
    );
    if (isCancelled(runtime)) return false;
    if (generateCode !== 0) {
      fail(
        runtime,
        `prisma generate failed in ${target.directory}/ (code ${String(generateCode)})`,
        generateCode,
      );
      return false;
    }

    if (!provision) {
      runtime.logs.append('system', `warning: ${NO_DATABASE_HINT}`);
      continue;
    }

    // Sync the schema into the session's own database — db push creates the
    // database itself when missing. Best-effort: failure means degraded
    // mode with an explanation, not a dead session.
    runtime.logs.append('system', `${target.kind}: npx prisma db push → ${provision.databaseName}`);
    let pushCode = await runToCompletion(
      'npx',
      ['prisma', 'db', 'push', '--accept-data-loss', '--skip-generate'],
      cwd,
      target.kind,
      runtime.logs,
      {},
      runtime.abort.signal,
    );
    if (isCancelled(runtime)) return false;

    if (pushCode !== 0) {
      /*
       * A plain push refuses one change even with --accept-data-loss:
       * adding a required column to a table that already has rows. The
       * run database is per-project and long-lived, and the validation
       * mesh's own tests insert rows into it — so the moment a rebuild
       * adds a required field, every later run pushed nothing, started
       * anyway, and the generated app answered writes with 500 while the
       * session still read RUNNING. Resetting is correct here and only
       * here: `${provision.databaseName}` holds one generated app's
       * scratch data, created by NexArch for this project and owned by
       * nothing else. Tried second, never first, so data survives
       * whenever the schema can be migrated around it.
       */
      runtime.logs.append(
        'system',
        `${target.kind}: schema could not be applied to the existing ${provision.databaseName} — resetting it and pushing again`,
      );
      pushCode = await runToCompletion(
        'npx',
        ['prisma', 'db', 'push', '--force-reset', '--accept-data-loss', '--skip-generate'],
        cwd,
        target.kind,
        runtime.logs,
        {},
        runtime.abort.signal,
      );
      if (isCancelled(runtime)) return false;
    }

    if (pushCode !== 0) {
      // Degraded, and said out loud: a session that reports RUNNING while
      // every write fails is worse than one that admits what is wrong.
      const warning = `The database schema could not be applied (prisma db push exited ${String(pushCode)}). The app will start, but anything that reads or writes ${provision.databaseName} will fail. Check NEXARCH_RUNNER_DATABASE_URL credentials and privileges.`;
      runtime.logs.append('system', `warning: ${warning}`);
      session.diagnostics = [...(session.diagnostics ?? []), warning];
    }
  }
  return true;
}

async function startTargets(runtime: SessionRuntime): Promise<void> {
  const { plan, session } = runtime;

  transition(runtime, 'starting', 'Starting processes on auto-detected free ports');
  // Allocate every port up front: the backend must know its own port, and
  // the frontend proxy + backend CORS each need to know the other's.
  const backendTarget = plan.targets.find((t) => t.kind === 'backend');
  const frontendTarget = plan.targets.find((t) => t.kind === 'frontend');
  const backendPort = backendTarget ? await findFreePort(portPreferenceFor('backend')) : null;
  const frontendPort = frontendTarget ? await findFreePort(portPreferenceFor('frontend')) : null;

  for (const target of plan.targets) {
    if (isCancelled(runtime)) return;
    const record = processOf(runtime, target.kind);
    const port = target.kind === 'backend' ? backendPort : frontendPort;
    if (port === null) continue;

    const env: Record<string, string> = { PORT: String(port) };
    const args = ['run', target.npmScript];
    if (target.kind === 'backend' && frontendPort !== null) {
      // Spawn env beats dotenv, so this wins over the .env default.
      env.CORS_ORIGINS = `http://localhost:${String(frontendPort)},http://127.0.0.1:${String(frontendPort)}`;
    }
    if (target.kind === 'frontend') {
      args.push('--', '--port', String(port), '--strictPort');
      // The generated vite.config proxies /api wherever BACKEND_URL points,
      // keeping the browser same-origin — no CORS in the hot path.
      if (backendPort !== null) env.BACKEND_URL = `http://127.0.0.1:${String(backendPort)}`;
    }

    const started = startProcess(
      'npm',
      args,
      `${session.workspaceDir}/${target.directory}`,
      env,
      target.kind,
      runtime.logs,
      (code) => {
        record.status = 'exited';
        record.exitCode = code;
        record.pid = null;
        if (!isCancelled(runtime) && ACTIVE_PHASES.includes(runtime.session.phase)) {
          fail(runtime, `${target.kind} exited unexpectedly (code ${String(code)})`, code);
        }
      },
    );

    record.status = 'starting';
    record.port = port;
    record.pid = started.pid;
    record.command = `${target.startCommand} (port ${String(port)})`;
    runtime.children.set(target.kind, started.child);
  }

  for (const target of plan.targets) {
    if (isCancelled(runtime)) return;
    const record = processOf(runtime, target.kind);
    if (record.port === null) continue;

    const answering = await waitUntilAnswering(record.port, () => isCancelled(runtime));
    if (isCancelled(runtime)) return;
    if (!answering) {
      fail(runtime, `${target.kind} never opened port ${String(record.port)}`, record.exitCode);
      return;
    }

    // A socket is not an application: RUNNING requires the HTTP layer to
    // answer (backend: its health route; frontend: the root document).
    const healthy = await waitUntilHealthy(record.port, target.healthPath, () =>
      isCancelled(runtime),
    );
    if (isCancelled(runtime)) return;
    if (!healthy) {
      fail(
        runtime,
        `${target.kind} opened port ${String(record.port)} but never answered HTTP GET ${target.healthPath}`,
        record.exitCode,
      );
      return;
    }
    record.status = 'running';
    record.url = `http://localhost:${String(record.port)}`;
    runtime.logs.append('system', `${target.kind} ready — ${record.url}`);
  }

  if (!isCancelled(runtime) && runtime.session.phase === 'starting') {
    const urls = session.processes
      .filter((p) => p.url)
      .map((p) => `${p.kind}: ${p.url ?? ''}`)
      .join(' · ');
    transition(runtime, 'running', `All processes up — ${urls}`);
    // The children hold the ports now; the reservations have done their job.
    releaseSessionPorts(runtime);
  }
}

/**
 * Registry failures worth trying again.
 *
 * Not every install failure is. A package.json naming a version that does
 * not exist fails identically every time, and retrying it three times costs
 * three minutes to deliver the same message. These markers describe the
 * registry briefly failing to serve something, which is a different thing
 * from the project asking for something impossible.
 *
 * `ETARGET` is on the list deliberately, and it is the interesting one. It
 * usually means a bad version pin — but it is also exactly what a partly
 * propagated release looks like: a generated project asked for
 * `typescript-eslint@^8.31.0`, npm resolved 8.72.1, and
 * `@typescript-eslint/eslint-plugin@8.72.1` was not yet visible on the
 * registry. That killed a preview outright, and the same install succeeded
 * minutes later untouched. A pin that is genuinely wrong still fails on the
 * final attempt and is reported with its own message.
 */
const TRANSIENT_INSTALL_MARKERS = [
  'etarget',
  'econnreset',
  'etimedout',
  'enotfound',
  'eai_again',
  'econnrefused',
  'err_socket_timeout',
  'socket hang up',
  'network',
  '429 too many requests',
  '503 service unavailable',
  'registry returned 5',
];

/**
 * Three attempts, not more: a registry hiccup clears in seconds, and a
 * fourth attempt mostly delays an honest error.
 */
const MAX_INSTALL_ATTEMPTS = 3;
const INSTALL_RETRY_BACKOFF_MS = 5_000;

/** The marker that makes a failure look transient, or null if none does. */
export function transientInstallReason(lines: readonly string[]): string | null {
  const text = lines.join('\n').toLowerCase();
  return TRANSIENT_INSTALL_MARKERS.find((marker) => text.includes(marker)) ?? null;
}

/** Sleeps, unless the session is aborted first. */
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/**
 * Installs every target, retrying a failure the registry caused.
 *
 * Returns false when the session should stop — cancelled, or an install that
 * failed for a reason trying again cannot fix.
 */
async function rebuildNamedPackages(
  runtime: SessionRuntime,
  target: { directory: string; kind: 'backend' | 'frontend' },
): Promise<void> {
  const directory = `${runtime.session.workspaceDir}/${target.directory}`;
  const present = INSTALL_SCRIPT_PACKAGES.filter((name) =>
    existsSync(join(directory, 'node_modules', name)),
  );
  if (present.length === 0) return;
  runtime.logs.append(
    'system',
    `${target.directory}: running install scripts for ${present.join(', ')}`,
  );
  const code = await runToCompletion(
    'npm',
    ['rebuild', ...present],
    directory,
    target.kind,
    runtime.logs,
    {},
    runtime.abort.signal,
  );
  if (code !== 0 && !isCancelled(runtime)) {
    runtime.logs.append(
      'system',
      `${target.directory}: npm rebuild exited ${String(code)} — ${present.join(', ')} may not work`,
    );
  }
}

async function installTargets(runtime: SessionRuntime): Promise<boolean> {
  const { plan, session } = runtime;
  transition(runtime, 'installing', 'Installing dependencies');

  for (const target of plan.targets) {
    if (isCancelled(runtime)) return false;
    const record = processOf(runtime, target.kind);
    record.status = 'installing';

    let code = 1;
    for (let attempt = 1; attempt <= MAX_INSTALL_ATTEMPTS; attempt += 1) {
      code = await runToCompletion(
        'npm',
        // Scripts off: what a project depends on can follow from web content,
        // and an install must not be a way to execute it.
        ['install', '--ignore-scripts', '--no-audit', '--no-fund'],
        `${session.workspaceDir}/${target.directory}`,
        target.kind,
        runtime.logs,
        {},
        runtime.abort.signal,
      );
      if (code === 0 || isCancelled(runtime)) break;

      const reason = transientInstallReason(runtime.logs.tail(40));
      if (reason === null || attempt === MAX_INSTALL_ATTEMPTS) break;

      runtime.logs.append(
        'system',
        `${target.directory}: npm install failed on a transient registry error (${reason}) — retrying, attempt ${String(attempt + 1)} of ${String(MAX_INSTALL_ATTEMPTS)}`,
      );
      logEvent({
        event: 'retry',
        target: `npm install ${target.directory}`,
        attempt: attempt + 1,
        reason,
      });
      await pause(INSTALL_RETRY_BACKOFF_MS * attempt, runtime.abort.signal);
      if (isCancelled(runtime)) return false;
    }

    if (isCancelled(runtime)) return false;
    if (code !== 0) {
      record.status = 'exited';
      record.exitCode = code;
      fail(runtime, `npm install failed in ${target.directory}/ (code ${String(code)})`, code);
      return false;
    }
    await rebuildNamedPackages(runtime, target);
    if (isCancelled(runtime)) return false;
    record.status = 'pending';
  }
  return true;
}

/**
 * Whether this workspace actually has its dependencies on disk.
 *
 * A restart used to assume it did — "the workspace and node_modules
 * survive" — which is true of a session that installed successfully and
 * false of exactly the session a user is most likely to press Restart on.
 * After a failed install there is no node_modules, so restarting spawned
 * dev servers that died on the first import, and the reported error was a
 * missing package rather than the install that never finished.
 */
function isInstalled(runtime: SessionRuntime): boolean {
  return runtime.plan.targets.every((target) =>
    existsSync(join(runtime.session.workspaceDir, target.directory, 'node_modules')),
  );
}

/**
 * Brings a restarted session back up, installing first if it never was.
 *
 * This is what makes Restart a real recovery from a failed install rather
 * than a second way to see the same failure.
 */
async function resumeSession(runtime: SessionRuntime): Promise<void> {
  if (!isInstalled(runtime)) {
    runtime.logs.append(
      'system',
      'Dependencies are not installed — installing before starting (the first install did not finish)',
    );
    if (!(await installTargets(runtime))) return;
    if (!(await configureTargets(runtime))) return;
  }
  await startTargets(runtime);
}

async function runPipeline(
  runtime: SessionRuntime,
  request: CreateSessionRequest,
  hooks: SessionHooks,
): Promise<void> {
  const { session } = runtime;

  transition(
    runtime,
    'preparing',
    `Writing ${String(request.files.length)} files to the workspace`,
  );
  session.workspaceDir = await writeWorkspace(
    session.id,
    slugify(request.projectName) || 'project',
    request.files,
  );
  if (isCancelled(runtime)) return;

  if (!(await installTargets(runtime))) return;

  const configured = await configureTargets(runtime);
  if (!configured) return;

  if (hooks.beforeStart) {
    await hooks.beforeStart({
      workspaceDir: session.workspaceDir,
      signal: runtime.abort.signal,
      targets: runtime.plan.targets,
    });
    if (isCancelled(runtime)) return;
  }

  await startTargets(runtime);
}

export function planSession(request: CreateSessionRequest): RunPlan {
  return planRun(request);
}

export function createSession(
  request: CreateSessionRequest,
  ownerId: string,
  hooks: SessionHooks = {},
): RunSession {
  // Refused here rather than in a route, so a builder or verification run
  // meets the same rule as a request from the preview page.
  const violations = checkProjectPolicy(request.files);
  if (violations.length > 0) {
    throw AppError.badRequest(`This project cannot be run: ${describeViolations(violations)}`);
  }

  const plan = planRun(request);
  if (plan.targets.length === 0) {
    throw AppError.badRequest(
      'Nothing to run — the project files contain no backend/package.json or frontend/package.json',
    );
  }

  const active = [...sessions.values()].filter((r) => ACTIVE_PHASES.includes(r.session.phase));
  const admission = runAdmission(
    active.map((r) => ({ ownerId: r.ownerId, projectName: r.session.projectName })),
    ownerId,
  );
  if (!admission.allowed) throw AppError.conflict(admission.message);

  const now = new Date().toISOString();
  const session: RunSession = {
    id: randomUUID(),
    projectName: request.projectName,
    phase: 'preparing',
    processes: plan.targets.map((target) => ({
      kind: target.kind,
      status: 'pending',
      port: null,
      url: null,
      command: target.startCommand,
      pid: null,
      exitCode: null,
    })),
    transitions: [],
    workspaceDir: '',
    diagnostics: null,
    createdAt: now,
    updatedAt: now,
  };

  const runtime: SessionRuntime = {
    session,
    ownerId,
    logs: new LogBuffer(),
    children: new Map(),
    plan,
    cancelled: false,
    abort: new AbortController(),
  };
  for (const warning of plan.warnings) runtime.logs.append('system', `warning: ${warning}`);

  sessions.set(session.id, runtime);
  // Bound memory: evict the oldest terminal sessions past the cap.
  if (sessions.size > MAX_SESSIONS) {
    for (const [id, record] of sessions) {
      if (sessions.size <= MAX_SESSIONS) break;
      if (!ACTIVE_PHASES.includes(record.session.phase)) sessions.delete(id);
    }
  }

  // Detached: the response is the preparing session; phases advance async.
  // Forked with the session id so every command this preview spawns, and
  // every process exit minutes later, is grouped under the session rather
  // than under the request that has already returned.
  withLogContext({ sessionId: session.id }, () => {
    void runPipeline(runtime, request, hooks).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('run session pipeline crashed', { sessionId: session.id, error: message });
      runtime.logs.append('system', message);
      fail(runtime, `Run pipeline error: ${message}`, null);
    });
  });

  return session;
}

function requireRuntime(id: string, ownerId: string): SessionRuntime {
  const runtime = sessions.get(id);
  // Not-yours is reported as not-found, so a session id cannot be probed for
  // existence across users.
  if (!runtime) throw AppError.notFound(`No run session with id ${id}`);
  if (!sameOwner(runtime.ownerId, ownerId)) throw AppError.notFound(`No run session with id ${id}`);
  return runtime;
}

export function getSession(id: string, ownerId: string): RunSession {
  return requireRuntime(id, ownerId).session;
}

export function listSessions(ownerId: string): RunSession[] {
  return [...sessions.values()]
    .filter((r) => r.ownerId === ownerId)
    .map((r) => r.session)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getLogs(id: string, after: number, ownerId: string): RunLogChunk {
  return requireRuntime(id, ownerId).logs.read(after);
}

export function stopSession(id: string, ownerId: string): RunSession {
  const runtime = requireRuntime(id, ownerId);
  if (!ACTIVE_PHASES.includes(runtime.session.phase)) {
    throw AppError.conflict(`Session is ${runtime.session.phase} — nothing to stop`);
  }
  runtime.cancelled = true;
  transition(runtime, 'stopping', 'Stop requested');
  // Kills an install or prisma command that is still running, not just the
  // dev servers: a stop during the install phase has no children to kill
  // and used to leave npm working away in the background.
  runtime.abort.abort();
  for (const child of runtime.children.values()) stopChild(child);
  runtime.children.clear();
  for (const record of runtime.session.processes) {
    if (record.status === 'running' || record.status === 'starting') record.status = 'exited';
    record.pid = null;
  }
  // Hand back any port this session reserved but never bound — a stop
  // between allocation and listen would otherwise hold it until the
  // reservation's TTL expired.
  releaseSessionPorts(runtime);
  transition(runtime, 'stopped', 'All processes stopped');
  // Counts, not paths: a cleanup line says what was released, and the
  // workspace directory is a path on someone's disk.
  logEvent({
    event: 'cleanup',
    target: 'runner session',
    outcome: 'removed',
    reason: `${String(runtime.session.processes.length)} processes stopped`,
  });
  return runtime.session;
}

export function restartSession(id: string, ownerId: string): RunSession {
  const runtime = requireRuntime(id, ownerId);
  if (ACTIVE_PHASES.includes(runtime.session.phase) && runtime.session.phase !== 'running') {
    throw AppError.conflict(`Session is ${runtime.session.phase} — wait for it to settle first`);
  }
  if (runtime.session.workspaceDir === '') {
    throw AppError.conflict('Session never materialized a workspace — create a new run instead');
  }

  // Stop whatever is live, then bring it back up. A session that installed
  // cleanly skips straight to `starting`; one whose install never finished
  // installs first, because its node_modules does not exist.
  runtime.cancelled = true;
  runtime.abort.abort();
  for (const child of runtime.children.values()) stopChild(child);
  runtime.children.clear();
  transition(runtime, 'restarting', 'Restarting processes');
  for (const record of runtime.session.processes) {
    record.status = 'pending';
    record.port = null;
    record.url = null;
    record.pid = null;
    record.exitCode = null;
  }
  runtime.session.diagnostics = null;
  runtime.cancelled = false;
  // An abort is permanent, so the restarted session needs a fresh one or
  // every command it runs from here would be refused before it spawned.
  runtime.abort = new AbortController();

  // Same reasoning as the first launch: a restart spawns fresh processes
  // whose exits land long after this call returned.
  withLogContext({ sessionId: runtime.session.id }, () => {
    void resumeSession(runtime).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      fail(runtime, `Restart error: ${message}`, null);
    });
  });

  return runtime.session;
}
