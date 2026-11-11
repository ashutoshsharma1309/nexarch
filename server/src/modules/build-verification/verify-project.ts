/**
 * Builds and runs a generated project, and reports only what happened.
 *
 * Reuses the Local Run Engine rather than being a second one: the session
 * installs, configures and starts, and this adds the project's own typecheck
 * and build between configuring and starting, then questions the live app.
 *
 * Success is never inferred. A step passes on an exit code of zero or on an
 * answer from the running process, and the run ends by confirming that the
 * processes are still alive, because an app that answers once and then dies
 * has not passed. The session is stopped on every path.
 */
import { join } from 'node:path';

import { publishExecutionEvent } from '../execution-events/execution-events.service.js';
import { startAwakeTimer } from '../runner/lib/awake-clock.js';
import { planProvisioning } from '../runner/lib/database-provisioner.js';
import { LogBuffer } from '../runner/lib/log-buffer.js';
import { removeRunWorkspace } from '../runner/lib/orphan-reaper.js';
import { runToCompletion } from '../runner/lib/process-supervisor.js';
import { checkProjectPolicy, describeViolations } from '../runner/lib/script-policy.js';
import {
  createSession,
  getLogs,
  getSession,
  INTERNAL_VERIFY_OWNER,
  planSession,
  stopSession,
  type SessionHooks,
} from '../runner/runner.service.js';
import type { CreateSessionRequest, RunPlan, RunSession } from '../runner/runner.types.js';
import { AppError } from '../../shared/utils/app-error.js';
import type {
  ProjectFile,
  VerificationResult,
  VerificationStepId,
  VerifyProjectOptions,
} from './build-verification.types.js';
import { checkLiveApplication, type Fetcher } from './lib/live-checks.js';
import { cleanOutput, firstErrorLine } from './lib/step-output.js';
import { VerifyContext, type Publish } from './lib/verify-context.js';

export interface VerifyDeps {
  plan: (request: CreateSessionRequest) => RunPlan;
  create: (request: CreateSessionRequest, hooks: SessionHooks) => RunSession;
  session: (id: string) => RunSession;
  logs: (id: string) => { stream: string; line: string }[];
  stop: (id: string) => void;
  run: (
    command: string,
    args: string[],
    cwd: string,
    area: 'backend' | 'frontend',
    logs: LogBuffer,
    signal: AbortSignal,
  ) => Promise<number>;
  fetch: Fetcher;
  publish: Publish;
  sleep: (ms: number) => Promise<void>;
  hasRunDatabase: () => boolean;
  discard: (workspaceDir: string) => void;
}

const DISCARD_DELAY_MS = 5_000;

export const DEFAULT_VERIFY_DEPS: VerifyDeps = {
  plan: planSession,
  create: (request, hooks) => createSession(request, INTERNAL_VERIFY_OWNER, hooks),
  session: (id) => getSession(id, INTERNAL_VERIFY_OWNER),
  logs: (id) => getLogs(id, 0, INTERNAL_VERIFY_OWNER).lines,
  stop: (id) => {
    stopSession(id, INTERNAL_VERIFY_OWNER);
  },
  run: (command, args, cwd, area, logs, signal) =>
    runToCompletion(command, args, cwd, area, logs, {}, signal),
  fetch: (input, init) => fetch(input, init),
  publish: publishExecutionEvent,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  hasRunDatabase: () => planProvisioning('probe') !== null,
  // Delayed so processes killed a moment ago have let go of their files.
  discard: (workspaceDir) => {
    setTimeout(() => removeRunWorkspace(workspaceDir), DISCARD_DELAY_MS).unref();
  },
};

/**
 * Awake time. Real projects took one to three minutes end to end, so this is
 * several times the slowest seen and still reports a hung run promptly.
 */
const DEFAULT_TIMEOUT_MS = 10 * 60_000;
/** How long a compile command just killed gets to report what it got through. */
const COMPILE_SETTLE_MS = 8_000;
const POLL_MS = 1_000;
const ADMISSION_WAIT_MS = 120_000;
const ADMISSION_RETRY_MS = 5_000;
const AFTER_INSTALL: VerificationStepId[] = ['typecheck', 'build', 'start', 'health', 'routes'];

type Target = RunPlan['targets'][number];
type CompileStep = 'typecheck' | 'build';

interface AreaCommand {
  program: string;
  args: string[];
  display: string;
}

function manifestOf(
  files: readonly ProjectFile[],
  directory: string,
): {
  scripts: Record<string, string>;
  hasTypescript: boolean;
} {
  try {
    const manifest = JSON.parse(
      files.find((file) => file.path === `${directory}/package.json`)?.content ?? '{}',
    ) as {
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return {
      scripts: manifest.scripts ?? {},
      hasTypescript: Boolean(
        manifest.devDependencies?.typescript ?? manifest.dependencies?.typescript,
      ),
    };
  } catch {
    return { scripts: {}, hasTypescript: false };
  }
}

/** The command for this step, from the project's manifest. Null when it has none. */
function commandFor(
  step: CompileStep,
  target: Target,
  files: readonly ProjectFile[],
): AreaCommand | null {
  const { scripts, hasTypescript } = manifestOf(files, target.directory);
  if (scripts[step]) {
    return { program: 'npm', args: ['run', step], display: `npm run ${step}` };
  }
  const hasConfig = files.some((file) => file.path === `${target.directory}/tsconfig.json`);
  if (step === 'typecheck' && hasConfig && hasTypescript) {
    return {
      program: 'npx',
      args: ['--no-install', 'tsc', '--noEmit', '-p', 'tsconfig.json'],
      display: 'npx --no-install tsc --noEmit -p tsconfig.json',
    };
  }
  return null;
}

/** Read through a call: an abort lands during the await, which TS cannot see. */
function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

function stopReason(context: VerifyContext): string {
  return context.options.signal?.aborted === true
    ? 'Verification was cancelled'
    : 'Verification timed out';
}

async function runCompileStep(
  deps: VerifyDeps,
  context: VerifyContext,
  step: CompileStep,
  targets: readonly Target[],
  workspaceDir: string,
  signal: AbortSignal,
): Promise<void> {
  const startedAt = Date.now();
  const sections: string[] = [];
  const commands: string[] = [];
  let failure: { directory: string; code: number; display: string; tail: string } | null = null;

  for (const target of targets) {
    if (signal.aborted) break;
    const command = commandFor(step, target, context.files);
    if (!command) continue;
    const logs = new LogBuffer();
    const code = await deps.run(
      command.program,
      command.args,
      join(workspaceDir, target.directory),
      target.kind,
      logs,
      signal,
    );
    const tail = logs.tail(80).join('\n');
    commands.push(`${target.directory}: ${command.display}`);
    sections.push(
      `--- ${target.directory}/ ${command.display} (exit ${String(code)}) ---\n${tail}`,
    );
    if (code !== 0 && !isAborted(signal) && failure === null) {
      failure = { directory: target.directory, code, display: command.display, tail };
    }
  }

  const durationMs = Date.now() - startedAt;
  const command = commands.length > 0 ? commands.join('; ') : null;
  const output = cleanOutput(sections.join('\n'), workspaceDir);

  if (signal.aborted) {
    // A command we killed says nothing about the code it was checking.
    context.steps.set(step, {
      id: step,
      status: 'blocked',
      command,
      exitCode: null,
      durationMs,
      summary: 'Stopped before it finished',
      output,
      reason: stopReason(context),
    });
    return;
  }
  if (commands.length === 0) {
    context.record({
      id: step,
      status: 'skipped',
      durationMs,
      summary: `No ${step} command is declared`,
      reason: `No target declares a ${step} script`,
    });
    return;
  }
  if (failure !== null) {
    const cause = firstErrorLine(cleanOutput(failure.tail, workspaceDir));
    context.record({
      id: step,
      status: 'failed',
      command,
      exitCode: failure.code,
      durationMs,
      output,
      summary: `${failure.display} failed in ${failure.directory}/ (exit ${String(failure.code)})${cause ? `: ${cause}` : ''}`,
    });
    return;
  }
  context.record({
    id: step,
    status: 'passed',
    command,
    exitCode: 0,
    durationMs,
    output,
    summary: `${step} exited 0 in ${String(commands.length)} target(s)`,
  });
}

/** Waits out a full run budget rather than failing a project for being busy. */
async function createWhenAdmitted(
  deps: VerifyDeps,
  context: VerifyContext,
  request: CreateSessionRequest,
  hooks: SessionHooks,
): Promise<RunSession> {
  const deadline = Date.now() + ADMISSION_WAIT_MS;
  for (;;) {
    try {
      return deps.create(request, hooks);
    } catch (error) {
      const busy = AppError.isAppError(error) && error.statusCode === 409;
      if (!busy || Date.now() >= deadline || context.signal.aborted) throw error;
      await deps.sleep(ADMISSION_RETRY_MS);
    }
  }
}

async function waitUntilSettled(
  deps: VerifyDeps,
  context: VerifyContext,
  sessionId: string,
): Promise<RunSession> {
  for (;;) {
    const session = deps.session(sessionId);
    if (['running', 'failed', 'stopped'].includes(session.phase)) return session;
    if (context.signal.aborted) return session;
    await deps.sleep(POLL_MS);
  }
}

function transitionTime(session: RunSession, phase: string): number | null {
  const entry = session.transitions.find((transition) => transition.phase === phase);
  return entry ? Date.parse(entry.at) : null;
}

function lastDetail(session: RunSession): string {
  return session.transitions[session.transitions.length - 1]?.detail ?? `Session ${session.phase}`;
}

function logTail(deps: VerifyDeps, context: VerifyContext, sessionId: string): string {
  const lines = deps.logs(sessionId).slice(-120);
  return cleanOutput(
    lines.map((entry) => `[${entry.stream}] ${entry.line}`).join('\n'),
    context.workspaceDir,
  );
}

function recordFailedSession(
  deps: VerifyDeps,
  context: VerifyContext,
  session: RunSession,
  reachedCompile: boolean,
  installStartedAt: number,
): void {
  const detail = lastDetail(session);
  const exitMatch = /\(code (\d+)\)/.exec(detail);
  const exitCode = exitMatch?.[1] ? Number.parseInt(exitMatch[1], 10) : null;
  const diagnostics = (session.diagnostics ?? []).join(' ');
  const summary = cleanOutput(diagnostics ? `${detail}: ${diagnostics}` : detail, null).slice(
    0,
    400,
  );
  const output = logTail(deps, context, session.id);

  if (!reachedCompile) {
    context.record({
      id: 'install',
      status: 'failed',
      exitCode,
      output,
      summary,
      durationMs: Date.now() - installStartedAt,
    });
    context.block(AFTER_INSTALL, 'Dependencies did not install');
    return;
  }

  const startedAt = transitionTime(session, 'starting') ?? Date.now();
  context.record({
    id: 'start',
    status: 'failed',
    command: session.processes.map((process) => process.command).join('; ') || null,
    exitCode:
      exitCode ?? session.processes.find((process) => process.exitCode !== null)?.exitCode ?? null,
    output,
    summary,
    durationMs: Date.now() - startedAt,
  });
  context.block(['health', 'routes'], 'The application did not start');
}

/**
 * Keeps what a stopped run really did.
 *
 * The session's own transitions say how far it got, so a timeout during the
 * start reports the finished install as passed instead of as "did not run",
 * and a step still working reports its command, its time and its log tail.
 */
function recordInterrupted(
  deps: VerifyDeps,
  context: VerifyContext,
  session: RunSession,
  reason: string,
  installCommand: string,
): void {
  const untouched = (id: VerificationStepId): boolean => {
    const step = context.steps.get(id);
    return step?.status === 'blocked' && step.command === null;
  };
  const installingAt = transitionTime(session, 'installing');
  const configuringAt = transitionTime(session, 'configuring');
  if (untouched('install') && installingAt !== null) {
    if (configuringAt !== null) {
      context.record({
        id: 'install',
        status: 'passed',
        command: installCommand,
        exitCode: 0,
        durationMs: configuringAt - installingAt,
        summary: 'Dependencies installed before verification stopped',
      });
    } else {
      context.record({
        id: 'install',
        status: 'blocked',
        command: installCommand,
        exitCode: null,
        durationMs: Date.now() - installingAt,
        summary: 'Still installing when verification stopped',
        output: logTail(deps, context, session.id),
        reason,
      });
    }
  }
  const startingAt = transitionTime(session, 'starting');
  if (untouched('start') && startingAt !== null) {
    context.record({
      id: 'start',
      status: 'blocked',
      command: session.processes.map((process) => process.command).join('; ') || null,
      exitCode: null,
      durationMs: Date.now() - startingAt,
      summary: 'Still starting when verification stopped',
      output: logTail(deps, context, session.id),
      reason,
    });
  }
}

async function runVerification(
  deps: VerifyDeps,
  context: VerifyContext,
  request: CreateSessionRequest,
): Promise<void> {
  const violations = checkProjectPolicy(context.files);
  if (violations.length > 0) {
    context.record({
      id: 'install',
      status: 'failed',
      summary: `Not installed: ${describeViolations(violations)}`.slice(0, 400),
      output: violations
        .map((entry) => `${entry.file}: ${entry.script}: ${entry.reason}`)
        .join('\n'),
      durationMs: 0,
    });
    context.block(AFTER_INSTALL, 'The project was refused before install');
    return;
  }

  const plan = deps.plan(request);
  if (plan.targets.length === 0) {
    context.record({
      id: 'install',
      status: 'failed',
      summary: 'Nothing to run: no backend or frontend with a dev or start script',
      output: plan.warnings.join('\n'),
      durationMs: 0,
    });
    context.block(AFTER_INSTALL, 'The project has no runnable target');
    return;
  }

  const installCommand = [...new Set(plan.targets.map((target) => target.installCommand))].join(
    '; ',
  );
  const installStartedAt = Date.now();
  let reachedCompile = false;
  let compileFinished: Promise<void> = Promise.resolve();

  const compile = async (
    workspaceDir: string,
    signal: AbortSignal,
    targets: readonly Target[],
  ): Promise<void> => {
    reachedCompile = true;
    context.workspaceDir = workspaceDir;
    context.record({
      id: 'install',
      status: 'passed',
      command: installCommand,
      exitCode: 0,
      durationMs: Date.now() - installStartedAt,
      summary: `Dependencies installed in ${String(targets.length)} target(s)`,
    });
    const combined = AbortSignal.any([signal, context.signal]);
    await runCompileStep(deps, context, 'typecheck', targets, workspaceDir, combined);
    await runCompileStep(deps, context, 'build', targets, workspaceDir, combined);
  };

  const hooks: SessionHooks = {
    beforeStart: ({ workspaceDir, signal, targets }) => {
      compileFinished = compile(workspaceDir, signal, targets);
      return compileFinished;
    },
  };

  let session: RunSession;
  try {
    session = await createWhenAdmitted(deps, context, request, hooks);
  } catch (error) {
    // Anything but the runner refusing this project is a platform fault, and
    // recording that as a project failure would send a repair after it.
    if (!AppError.isAppError(error)) throw error;
    const message = error.message;
    if (error.statusCode === 409) {
      context.note(`No run capacity was available: ${message}`);
      context.block(['install', ...AFTER_INSTALL], 'No run capacity was available');
      return;
    }
    context.record({
      id: 'install',
      status: 'failed',
      summary: cleanOutput(message, null).slice(0, 400),
      durationMs: Date.now() - installStartedAt,
    });
    context.block(AFTER_INSTALL, 'The run could not be created');
    return;
  }

  try {
    const settled = await waitUntilSettled(deps, context, session.id);
    context.workspaceDir = context.workspaceDir ?? (settled.workspaceDir || null);

    if (context.signal.aborted) {
      const reason = stopReason(context);
      // The command this just killed still has to say what it got through.
      await Promise.race([
        compileFinished,
        new Promise((resolve) => setTimeout(resolve, COMPILE_SETTLE_MS).unref()),
      ]);
      recordInterrupted(deps, context, settled, reason, installCommand);
      context.note(`${reason} during: ${lastDetail(settled)}`);
      context.block(['install', ...AFTER_INSTALL], reason);
    } else if (settled.phase === 'failed') {
      recordFailedSession(deps, context, settled, reachedCompile, installStartedAt);
    } else if (settled.phase !== 'running') {
      context.note(`The run session ended as ${settled.phase} before it could be checked`);
      context.block(['install', ...AFTER_INSTALL], `The run session ended as ${settled.phase}`);
    } else {
      await checkLiveApplication({
        context,
        session: settled,
        fetcher: deps.fetch,
        hasRunDatabase: deps.hasRunDatabase(),
        reread: () => deps.session(session.id),
        output: () => logTail(deps, context, session.id),
      });
    }
  } finally {
    // Failed and stopped sessions refuse a stop; the outcome is what matters.
    try {
      deps.stop(session.id);
    } catch {
      // Already settled.
    }
    if (context.workspaceDir) deps.discard(context.workspaceDir);
  }
}

/** Seam for tests: the behaviour worth proving is what happens on failure. */
export async function verifyProjectWith(
  deps: VerifyDeps,
  files: readonly ProjectFile[],
  options: VerifyProjectOptions,
): Promise<VerificationResult> {
  const controller = new AbortController();
  const timer = startAwakeTimer(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, () => {
    controller.abort();
  });
  const onCancel = (): void => {
    controller.abort();
  };
  options.signal?.addEventListener('abort', onCancel, { once: true });
  if (options.signal?.aborted === true) controller.abort();

  const context = new VerifyContext(files, options, controller.signal, deps.publish);
  context.begin();
  try {
    await runVerification(deps, context, {
      projectName: `verify-${options.projectId.slice(0, 8)}`,
      files: [...files],
    });
  } catch (error) {
    // A verifier fault says nothing about the project, so it blocks.
    const message = error instanceof Error ? error.message : String(error);
    context.note(`Verification itself failed: ${cleanOutput(message, null).slice(0, 300)}`);
    context.block(['install', ...AFTER_INSTALL], 'Verification itself failed');
  } finally {
    timer.stop();
    options.signal?.removeEventListener('abort', onCancel);
  }
  const awayMs = timer.suspendedMs();
  if (awayMs > 0) {
    context.note(
      `The server was paused for about ${String(Math.round(awayMs / 1_000))}s during verification (the machine asleep, or too busy to run it); that time was not counted against the limit`,
    );
  }
  return context.finish();
}

export function verifyProject(
  files: readonly ProjectFile[],
  options: VerifyProjectOptions,
): Promise<VerificationResult> {
  return verifyProjectWith(DEFAULT_VERIFY_DEPS, files, options);
}
