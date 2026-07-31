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
import { diagnose } from './lib/diagnostics.js';
import { LogBuffer } from './lib/log-buffer.js';
import { findFreePort } from './lib/port-scanner.js';
import {
  runToCompletion,
  startProcess,
  stopChild,
  waitUntilAnswering,
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
  logs: LogBuffer;
  children: Map<ProcessKind, ChildProcess>;
  plan: RunPlan;
  cancelled: boolean;
}

const ACTIVE_PHASES: RunPhase[] = ['preparing', 'installing', 'starting', 'running', 'restarting'];
const MAX_SESSIONS = 30;

const sessions = new Map<string, SessionRuntime>();

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

async function startTargets(runtime: SessionRuntime): Promise<void> {
  const { plan, session } = runtime;

  transition(runtime, 'starting', 'Starting processes on auto-detected free ports');
  const backendTarget = plan.targets.find((t) => t.kind === 'backend');
  const backendPort = backendTarget ? await findFreePort(portPreferenceFor('backend')) : null;

  for (const target of plan.targets) {
    if (isCancelled(runtime)) return;
    const record = processOf(runtime, target.kind);
    const port =
      target.kind === 'backend' && backendPort !== null
        ? backendPort
        : await findFreePort(portPreferenceFor(target.kind));

    if (target.envFile) {
      await ensureEnvFile(
        session.workspaceDir,
        target.envFile.path,
        target.envFile.derivedFrom,
        target.kind === 'backend' ? { PORT: String(port) } : {},
      );
    }

    const env: Record<string, string> = { PORT: String(port) };
    const args = ['run', target.npmScript];
    if (target.kind === 'frontend') {
      // Vite honors --port/--strictPort; also point the client at the real
      // backend for projects that read VITE_API_BASE_URL.
      args.push('--', '--port', String(port), '--strictPort');
      if (backendPort !== null)
        env.VITE_API_BASE_URL = `http://localhost:${String(backendPort)}/api/v1`;
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
    const ready = await waitUntilAnswering(record.port, () => isCancelled(runtime));
    if (isCancelled(runtime)) return;
    if (!ready) {
      fail(
        runtime,
        `${target.kind} never answered on port ${String(record.port)}`,
        record.exitCode,
      );
      return;
    }
    record.status = 'running';
    record.url = `http://localhost:${String(record.port)}`;
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

  await startTargets(runtime);
}

export function planSession(request: CreateSessionRequest): RunPlan {
  return planRun(request);
}

export function createSession(request: CreateSessionRequest): RunSession {
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

function requireRuntime(id: string): SessionRuntime {
  const runtime = sessions.get(id);
  if (!runtime) throw AppError.notFound(`No run session with id ${id}`);
  return runtime;
}

export function getSession(id: string): RunSession {
  return requireRuntime(id).session;
}

export function listSessions(): RunSession[] {
  return [...sessions.values()]
    .map((r) => r.session)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getLogs(id: string, after: number): RunLogChunk {
  return requireRuntime(id).logs.read(after);
}

export function stopSession(id: string): RunSession {
  const runtime = requireRuntime(id);
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

export function restartSession(id: string): RunSession {
  const runtime = requireRuntime(id);
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
