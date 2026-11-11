/**
 * Runs the generated project for real, through the Local Run Engine.
 *
 * This file is deliberately thin over the runner: `createSession` already
 * knows how to materialize a file set, install its dependencies, provision
 * a database, pick free ports and supervise the processes — Step 1 forbids
 * a second execution engine, and there is nothing here that resembles one.
 * What this adds is the part a preview never needed: running the project's
 * *own* build, typecheck and lint scripts and reading their exit codes,
 * because "it serves requests" and "it compiles" are different facts and a
 * validation must establish both.
 *
 * Command names come from each area's package.json, never assumed. A
 * project with no `lint` script gets `lintStatus: SKIPPED`, not a guessed
 * command and not a fake pass — a skipped check is a fact too.
 *
 * Every piece of output that leaves this module passes through `scrub`,
 * because logs are where secrets go to be accidentally published.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { AppError } from '../../../shared/utils/app-error.js';
import { logger } from '../../../shared/logger/index.js';
import { logEvent } from '../../../shared/logger/events.js';
import {
  createSession,
  getLogs,
  getSession,
  INTERNAL_RUNNER_OWNER,
  stopSession,
} from '../../runner/runner.service.js';
import { LogBuffer } from '../../runner/lib/log-buffer.js';
import { runToCompletion } from '../../runner/lib/process-supervisor.js';
import type {
  CheckStatus,
  CommandResult,
  RuntimeResult,
} from '../../../shared/types/validation.js';

export interface RuntimeValidationInput {
  projectId: string;
  runId: string;
  projectName: string;
  files: { path: string; content: string }[];
  /** Stops the wait and the project's scripts, and releases the session. */
  signal?: AbortSignal;
}

/** Raised when the runner stayed full for the whole admission wait. */
export class RunCapacityUnavailable extends Error {
  constructor() {
    super('The platform had no free run capacity for live checks, so they could not start.');
    this.name = 'RunCapacityUnavailable';
  }
}

/**
 * Creates the session, waiting a bounded time for room.
 *
 * The internal owner is shared by every user's edits and validations, so a
 * full budget is ordinary traffic. The runner's 409 is worded for one person
 * looking at their own runs, which would be wrong here.
 */
export async function createWhenAdmitted<T>(
  create: () => T,
  signal: AbortSignal | undefined,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((done) => setTimeout(done, ms)),
  now: () => number = Date.now,
): Promise<T> {
  const deadline = now() + ADMISSION_WAIT_MS;
  for (;;) {
    try {
      return create();
    } catch (error) {
      if (!AppError.isAppError(error) || error.statusCode !== 409) throw error;
      if (signal?.aborted) throw new Error('Validation cancelled before it started.');
      if (now() >= deadline) throw new RunCapacityUnavailable();
      await sleep(ADMISSION_RETRY_MS);
    }
  }
}

/** Values that look like credentials, blunted before output leaves. */
export function scrub(text: string): string {
  return text
    .replace(/\b(?:gsk|sk|pk|rk)_[A-Za-z0-9]{8,}\b/g, '***')
    .replace(/(\b(?:password|secret|token|api[_-]?key)\b\s*[=:]\s*)\S+/gi, '$1***')
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/([^:\s'"]+):[^@\s'"]+@/gi, '$1:***@');
}

/**
 * Patterns worth surfacing from runtime logs, each a real failure mode
 * rather than a warning promoted to one. `fatal` marks the ones that mean
 * the process is not actually serving.
 */
const LOG_SIGNALS: { pattern: RegExp; name: string; fatal: boolean }[] = [
  { pattern: /EADDRINUSE/, name: 'port already in use', fatal: true },
  { pattern: /Cannot find module|MODULE_NOT_FOUND/, name: 'missing module', fatal: true },
  {
    pattern: /UnhandledPromiseRejection|uncaughtException/,
    name: 'uncaught exception',
    fatal: false,
  },
  {
    pattern: /P1001|ECONNREFUSED.*3306|Can't reach database/i,
    name: 'database unreachable',
    fatal: true,
  },
  {
    pattern: /Missing (?:required )?environment|is not set\b/i,
    name: 'missing environment variable',
    fatal: false,
  },
  { pattern: /EACCES|permission denied/i, name: 'permission denied', fatal: true },
];

function scanLogs(lines: readonly { stream: string; line: string }[]): RuntimeResult['logSignals'] {
  const hits = new Map<string, { count: number; sample: string }>();
  for (const entry of lines) {
    for (const signal of LOG_SIGNALS) {
      if (!signal.pattern.test(entry.line)) continue;
      const existing = hits.get(signal.name);
      if (existing) existing.count += 1;
      else hits.set(signal.name, { count: 1, sample: scrub(entry.line).slice(0, 160) });
    }
  }
  return [...hits.entries()].map(([pattern, value]) => ({ pattern, ...value }));
}

/** The scripts an area's manifest actually declares. */
function scriptsOf(workspaceDir: string, area: string): Record<string, string> {
  try {
    const manifest = JSON.parse(readFileSync(join(workspaceDir, area, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    return manifest.scripts ?? {};
  } catch {
    return {};
  }
}

/**
 * Runs one npm script to completion and reports what happened.
 *
 * Uses the runner's own supervised spawn, so the child is tracked, killed
 * on process exit, and cannot outlive NexArch any more than a preview can.
 */
async function runScript(
  workspaceDir: string,
  area: 'backend' | 'frontend',
  script: string,
  signal?: AbortSignal,
): Promise<CommandResult> {
  const startedAt = Date.now();
  const logs = new LogBuffer();
  const exitCode = await runToCompletion(
    'npm',
    ['run', script],
    join(workspaceDir, area),
    area,
    logs,
    {},
    signal,
  );
  const tail = logs
    .tail(12)
    .map((line) => scrub(line))
    .join('\n');

  return {
    command: `npm run ${script}`,
    area,
    exitCode,
    durationMs: Date.now() - startedAt,
    status: exitCode === 0 ? 'PASS' : 'FAIL',
    outputTail: tail.length > 1_500 ? `${tail.slice(0, 1_497)}…` : tail,
  };
}

const SESSION_TIMEOUT_MS = 300_000;
const POLL_MS = 2_000;
const ADMISSION_WAIT_MS = 120_000;
const ADMISSION_RETRY_MS = 3_000;

async function waitForSession(
  sessionId: string,
  signal?: AbortSignal,
): Promise<ReturnType<typeof getSession>> {
  const deadline = Date.now() + SESSION_TIMEOUT_MS;
  for (;;) {
    const session = getSession(sessionId, INTERNAL_RUNNER_OWNER);
    if (['running', 'failed', 'stopped'].includes(session.phase)) return session;
    if (signal?.aborted || Date.now() > deadline) return session;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

async function probe(url: string): Promise<{ status: number | null; body: string }> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    return { status: response.status, body: (await response.text()).slice(0, 400) };
  } catch {
    return { status: null, body: '' };
  }
}

export interface RuntimeValidation {
  result: RuntimeResult;
  /** Live URLs for the downstream agents, when startup succeeded. */
  baseUrls: { backend: string | null; frontend: string | null };
  sessionId: string;
}

/**
 * The whole runtime validation: start, check, build, scan.
 *
 * The session is *left running* on success — the integration and test
 * engineers need the live application, and installing it three times to
 * keep each agent self-contained would triple the slowest step of the
 * entire mesh. The scheduler owns stopping it when the run settles; on a
 * startup failure there is nothing downstream worth keeping and the
 * session is stopped here.
 */
export async function validateRuntime(input: RuntimeValidationInput): Promise<RuntimeValidation> {
  const startedAt = Date.now();
  const errors: string[] = [];
  // The opening half of the pair. Published before the install starts,
  // because this is the slowest thing the mesh does and a validation that
  // never came back should be visible as a start with no end rather than as
  // a gap in the timeline.
  logEvent({ event: 'validation.start', target: `runtime: ${input.projectName}` });

  const session = await createWhenAdmitted(
    () =>
      createSession(
        {
          projectName: input.projectName,
          files: input.files,
        },
        INTERNAL_RUNNER_OWNER,
      ),
    input.signal,
  );

  // A cancel must free the run slot now, so nothing is reported from here on.
  const abandonIfCancelled = (): void => {
    if (!input.signal?.aborted) return;
    try {
      stopSession(session.id, INTERNAL_RUNNER_OWNER);
    } catch (error) {
      logger.debug('failed to stop cancelled validation session', { sessionId: session.id, error });
    }
    throw new Error('Validation cancelled.');
  };

  const settled = await waitForSession(session.id, input.signal);
  abandonIfCancelled();
  const started = settled.phase === 'running';
  const workspaceDir = settled.workspaceDir || null;

  const backend = settled.processes.find((process) => process.kind === 'backend');
  const frontend = settled.processes.find((process) => process.kind === 'frontend');

  /* ── Health: ask the running thing, not the plan ──────────────────── */

  let healthStatus: CheckStatus = 'BLOCKED';
  if (started && backend?.url) {
    const health = await probe(`${backend.url}/api/v1/health`);
    if (health.status === 200) {
      healthStatus = 'PASS';
    } else if (health.status === null) {
      healthStatus = 'FAIL';
      errors.push(`Health probe: ${backend.url}/api/v1/health did not answer`);
    } else {
      healthStatus = 'FAIL';
      errors.push(`Health probe: expected 200, got ${String(health.status)}`);
    }
  } else if (!started) {
    errors.push(`Startup: session ended in phase "${settled.phase}"`);
    for (const diagnostic of settled.diagnostics ?? []) errors.push(scrub(diagnostic));
  }

  /* ── The project's own commands, read from its own manifests ──────── */

  const commands: CommandResult[] = [];
  if (workspaceDir) {
    for (const area of ['backend', 'frontend'] as const) {
      const scripts = scriptsOf(workspaceDir, area);
      for (const script of ['typecheck', 'build', 'lint']) {
        if (!(script in scripts)) continue;
        commands.push(await runScript(workspaceDir, area, script, input.signal));
        abandonIfCancelled();
      }
    }
  }

  const statusOf = (script: string): CheckStatus => {
    const matching = commands.filter((command) => command.command === `npm run ${script}`);
    if (matching.length === 0) return workspaceDir ? 'SKIPPED' : 'BLOCKED';
    return matching.every((command) => command.status === 'PASS') ? 'PASS' : 'FAIL';
  };

  // Not added to `errors`: that list explains startup and health, and readers
  // print it beside the Startup row, which then contradicted its own PASS. The
  // failed commands are reported by their own build and typecheck statuses.
  const failedCommands = commands
    .filter((entry) => entry.status === 'FAIL')
    .map((entry) => `${entry.command} (${entry.area}) exited ${String(entry.exitCode)}`);

  /* ── Logs, scanned rather than read aloud ─────────────────────────── */

  const logSignals = scanLogs(getLogs(session.id, 0, INTERNAL_RUNNER_OWNER).lines);

  const result: RuntimeResult = {
    projectId: input.projectId,
    runId: input.runId,
    sessionId: session.id,
    workspaceDir,
    buildStatus: statusOf('build'),
    typeCheckStatus: statusOf('typecheck'),
    lintStatus: statusOf('lint'),
    startupStatus: started ? 'PASS' : 'FAIL',
    healthStatus,
    processStatus:
      started && settled.processes.every((process) => process.status === 'running')
        ? 'PASS'
        : started
          ? 'FAIL'
          : 'BLOCKED',
    commands,
    processes: settled.processes.map((process) => ({
      kind: process.kind,
      status: process.status,
      port: process.port,
      url: process.url,
    })),
    logSignals,
    durationMs: Date.now() - startedAt,
    errors,
    createdAt: new Date().toISOString(),
  };

  // The outcome, from the figures just assembled rather than from a second
  // measurement. `issues` counts the checks that actually failed, so a
  // BLOCKED check — one that never got to run — is not reported as a failure
  // the generated project caused.
  const failedChecks = [
    result.buildStatus,
    result.typeCheckStatus,
    result.lintStatus,
    result.startupStatus,
    result.healthStatus,
  ].filter((status) => status === 'FAIL').length;
  logEvent({
    event: 'validation',
    target: `runtime: ${input.projectName}`,
    outcome: failedChecks === 0 && started ? 'passed' : 'failed',
    issues: failedChecks,
    durationMs: result.durationMs,
    blocking: true,
    ...(errors.length + failedCommands.length === 0
      ? {}
      : { reason: errors[0] ?? failedCommands[0] }),
  });

  if (!started) {
    // Nothing downstream can use a dead session; release it now.
    try {
      stopSession(session.id, INTERNAL_RUNNER_OWNER);
    } catch (error) {
      logger.debug('failed to stop dead validation session', { sessionId: session.id, error });
    }
  }

  return {
    result,
    baseUrls: {
      backend: started ? (backend?.url ?? null) : null,
      frontend: started ? (frontend?.url ?? null) : null,
    },
    sessionId: session.id,
  };
}
