/**
 * Run-session lifecycle. Sessions live in an in-memory registry (the AI
 * Orchestrator's history model); the pipeline runs detached from the
 * request — POST answers with the `preparing` session and the phases
 * advance as the work happens: preparing → installing → starting →
 * running, with stopping/stopped/restarting/failed reachable from the
 * obvious places. Every failure path funnels through `fail()`, which
 * attaches human diagnostics from the log tail — a session dies with an
 * explanation, and the platform process never dies with it.
 */
import { randomUUID } from 'node:crypto';

import { logger } from '../../shared/logger/index.js';
import { AppError } from '../../shared/utils/app-error.js';
import { slugify } from '../../shared/utils/strings.js';
import { planRun, portPreferenceFor } from './lib/command-planner.js';
import { NO_DATABASE_HINT, planProvisioning } from './lib/database-provisioner.js';
import { diagnose } from './lib/diagnostics.js';
import { LogBuffer } from './lib/log-buffer.js';
import { findFreePort } from './lib/port-scanner.js';
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

/**
 * Read through a call boundary: `cancelled` is flipped concurrently by
 * stop/restart while the pipeline awaits, which TS's flow narrowing
 * cannot see — direct property checks get narrowed to "always false".
 */
function isCancelled(runtime: SessionRuntime): boolean {
  return runtime.cancelled;
}

function maxActiveSessions(): number {
  // Optional per-deployment knob, same convention as the provider keys.
  const raw = process.env.NEXARCH_RUNNER_MAX_SESSIONS;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 2;
}

function transition(runtime: SessionRuntime, phase: RunPhase, detail: string): void {
  runtime.session.phase = phase;
  runtime.session.updatedAt = new Date().toISOString();
  runtime.session.transitions.push({ phase, at: runtime.session.updatedAt, detail });
  runtime.logs.append('system', detail);
}

function fail(runtime: SessionRuntime, detail: string, exitCode: number | null): void {
  if (runtime.session.phase === 'failed' || runtime.session.phase === 'stopped') return;
  runtime.session.diagnostics = diagnose(exitCode, runtime.logs.tail(40));
  transition(runtime, 'failed', detail);
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
    const pushCode = await runToCompletion(
      'npx',
      ['prisma', 'db', 'push', '--accept-data-loss', '--skip-generate'],
      cwd,
      target.kind,
      runtime.logs,
    );
    if (isCancelled(runtime)) return false;
    if (pushCode !== 0) {
      runtime.logs.append(
        'system',
        `warning: prisma db push failed (code ${String(pushCode)}) — check NEXARCH_RUNNER_DATABASE_URL credentials/privileges; the backend will run in degraded mode`,
      );
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
  }
}

async function runPipeline(runtime: SessionRuntime, request: CreateSessionRequest): Promise<void> {
  const { plan, session } = runtime;

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

  transition(runtime, 'installing', 'Installing dependencies');
  for (const target of plan.targets) {
    if (isCancelled(runtime)) return;
    const record = processOf(runtime, target.kind);
    record.status = 'installing';
    const code = await runToCompletion(
      'npm',
      ['install', '--no-audit', '--no-fund'],
      `${session.workspaceDir}/${target.directory}`,
      target.kind,
      runtime.logs,
    );
    if (isCancelled(runtime)) return;
    if (code !== 0) {
      record.status = 'exited';
      record.exitCode = code;
      fail(runtime, `npm install failed in ${target.directory}/ (code ${String(code)})`, code);
      return;
    }
    record.status = 'pending';
  }

  const configured = await configureTargets(runtime);
  if (!configured) return;

  await startTargets(runtime);
}

export function planSession(request: CreateSessionRequest): RunPlan {
  return planRun(request);
}

export function createSession(request: CreateSessionRequest, ownerId: string): RunSession {
  const plan = planRun(request);
  if (plan.targets.length === 0) {
    throw AppError.badRequest(
      'Nothing to run — the project files contain no backend/package.json or frontend/package.json',
    );
  }

  const active = [...sessions.values()].filter((r) => ACTIVE_PHASES.includes(r.session.phase));
  if (active.length >= maxActiveSessions()) {
    throw AppError.conflict(
      `Run limit reached (${String(active.length)} active) — stop a session first or raise NEXARCH_RUNNER_MAX_SESSIONS`,
    );
  }

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
  void runPipeline(runtime, request).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('run session pipeline crashed', { sessionId: session.id, error: message });
    runtime.logs.append('system', message);
    fail(runtime, `Run pipeline error: ${message}`, null);
  });

  return session;
}

function requireRuntime(id: string, ownerId: string): SessionRuntime {
  const runtime = sessions.get(id);
  // Not-yours is reported as not-found, so a session id cannot be probed for
  // existence across users.
  if (!runtime) throw AppError.notFound(`No run session with id ${id}`);
  if (runtime.ownerId !== ownerId) throw AppError.notFound(`No run session with id ${id}`);
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
  for (const child of runtime.children.values()) stopChild(child);
  runtime.children.clear();
  for (const record of runtime.session.processes) {
    if (record.status === 'running' || record.status === 'starting') record.status = 'exited';
    record.pid = null;
  }
  transition(runtime, 'stopped', 'All processes stopped');
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

  // Stop whatever is live, then re-run the start step only: the workspace
  // and node_modules survive, so a restart skips straight to `starting`.
  runtime.cancelled = true;
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

  void startTargets(runtime).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    fail(runtime, `Restart error: ${message}`, null);
  });

  return runtime.session;
}
