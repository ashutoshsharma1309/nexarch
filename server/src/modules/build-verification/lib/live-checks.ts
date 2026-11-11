/**
 * Questions for an application the runner says is up.
 *
 * "Running" only means every process answered once. This records the start,
 * asks for health and routes, then re-reads the session, so a process that
 * died under its first real request cannot leave a pass on the record.
 */
import type { RunSession } from '../../runner/runner.types.js';
import type { DeclaredRoute } from '../build-verification.types.js';
import {
  checkBackendHealth,
  checkFrontend,
  checkRoutes,
  discoverFrontendPages,
  withoutParameters,
  type Fetcher,
  type HealthOutcome,
} from './http-checks.js';
import type { VerifyContext } from './verify-context.js';

export type { Fetcher } from './http-checks.js';

export interface LiveCheckInput {
  context: VerifyContext;
  session: RunSession;
  fetcher: Fetcher;
  hasRunDatabase: boolean;
  reread: () => RunSession;
  output: () => string;
}

function urlOf(session: RunSession, kind: 'backend' | 'frontend'): string | null {
  return session.processes.find((process) => process.kind === kind)?.url ?? null;
}

function routesToCheck(input: LiveCheckInput): DeclaredRoute[] {
  const { context } = input;
  const declared = context.options.routes ?? [];
  const pages = discoverFrontendPages(context.files).map((path) => ({ method: 'GET', path }));

  const seen = new Set<string>();
  const unique = [...declared, ...pages].filter((route) => {
    const key = `${route.method.toUpperCase()} ${route.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const parameterised = unique.filter((route) => !withoutParameters(route.path));
  if (parameterised.length > 0) {
    context.note(
      `${String(parameterised.length)} route(s) with path parameters were not requested, because no real id was available: ${parameterised
        .slice(0, 10)
        .map((route) => route.path)
        .join(', ')}`,
    );
  }

  if (urlOf(input.session, 'backend') && !declared.some((route) => route.path.startsWith('/api'))) {
    context.note('No backend API routes were declared, so only the health route was requested.');
  }
  if (urlOf(input.session, 'frontend') && pages.length > 0) {
    context.note(
      'A client-rendered app answers every page with the same document, so page checks confirm the server responded, not that each page renders.',
    );
  }
  return unique.filter((route) => withoutParameters(route.path));
}

async function recordHealth(input: LiveCheckInput): Promise<boolean> {
  const { context, session, fetcher, hasRunDatabase } = input;
  const startedAt = Date.now();
  const backend = urlOf(session, 'backend');
  const frontend = urlOf(session, 'frontend');
  const outcomes: HealthOutcome[] = [];
  if (backend) outcomes.push(await checkBackendHealth(fetcher, backend, context.signal));
  if (frontend) outcomes.push(await checkFrontend(fetcher, frontend, context.signal));

  const degraded = outcomes.some((outcome) => outcome.degraded);
  // Degraded with nowhere to connect is this machine's configuration. With a
  // database configured, the app failed to reach one it was given.
  const degradedIsFailure = degraded && hasRunDatabase;
  if (degraded && !hasRunDatabase) {
    context.note(
      'No run database is configured, so the backend ran degraded and anything that reads or writes data could not be verified.',
    );
  }

  const failing = outcomes.find((outcome) => !outcome.ok);
  const ok = !failing && !degradedIsFailure && outcomes.length > 0;
  const summary = outcomes.map((outcome) => outcome.summary).join('; ');
  context.record({
    id: 'health',
    status: ok ? 'passed' : 'failed',
    durationMs: Date.now() - startedAt,
    summary: summary || 'No process exposed a URL to check',
    output: outcomes
      .map((outcome) => outcome.detail)
      .filter(Boolean)
      .join('\n'),
  });
  return degraded && !hasRunDatabase;
}

async function recordRoutes(input: LiveCheckInput, noDatabase: boolean): Promise<void> {
  const { context, session, fetcher } = input;
  const startedAt = Date.now();
  const routes = routesToCheck(input);
  if (routes.length === 0) {
    context.record({
      id: 'routes',
      status: 'skipped',
      durationMs: 0,
      summary: 'No concrete routes or pages to request',
      reason: 'None were declared and none were found in the frontend source',
    });
    return;
  }

  const checks = await checkRoutes(
    fetcher,
    routes,
    { backend: urlOf(session, 'backend'), frontend: urlOf(session, 'frontend') },
    context.signal,
  );
  for (const check of checks) {
    const databaseMissing =
      noDatabase && check.status === 'failed' && (check.actualStatus ?? 0) >= 500;
    context.recordRoute(
      databaseMissing
        ? {
            ...check,
            status: 'blocked',
            detail: `Answered ${String(check.actualStatus)} with no run database configured`,
          }
        : check,
    );
  }

  const failed = context.routes.filter((check) => check.status === 'failed');
  const passed = context.routes.filter((check) => check.status === 'passed');
  const blocked = context.routes.filter((check) => check.status === 'blocked');
  // A blocked route is an unanswered question. Page hits on a client-rendered
  // app say nothing about it, so one blocked route keeps the step from passing.
  const status =
    failed.length > 0 ? 'failed' : blocked.length > 0 || passed.length === 0 ? 'blocked' : 'passed';
  context.record({
    id: 'routes',
    status,
    durationMs: Date.now() - startedAt,
    summary: `${String(passed.length)} of ${String(context.routes.length)} route(s) answered as expected`,
    output: failed
      .map(
        (check) =>
          `${check.method} ${check.path}: ${String(check.actualStatus ?? 'no answer')} ${check.detail ?? ''}`,
      )
      .join('\n'),
    ...(status === 'blocked'
      ? {
          reason: `${String(blocked.length)} route(s) could not be judged in this environment: ${blocked
            .slice(0, 5)
            .map((check) => `${check.method} ${check.path}`)
            .join(', ')}`,
        }
      : {}),
  });
}

export async function checkLiveApplication(input: LiveCheckInput): Promise<void> {
  const { context, session } = input;
  const startedAt = session.transitions.find((entry) => entry.phase === 'starting')?.at;
  const runningAt = session.transitions.find((entry) => entry.phase === 'running')?.at;
  const command = session.processes.map((process) => process.command).join('; ');
  context.record({
    id: 'start',
    status: 'passed',
    command,
    exitCode: null,
    durationMs: startedAt && runningAt ? Date.parse(runningAt) - Date.parse(startedAt) : 0,
    summary: `${String(session.processes.length)} process(es) started and answered over HTTP`,
  });
  context.note(
    'The app was started with its dev script, so the compiled production output was built but not served.',
  );

  const noDatabase = await recordHealth(input);
  await recordRoutes(input, noDatabase);

  const after = input.reread();
  if (after.phase !== 'running') {
    const detail = after.transitions[after.transitions.length - 1]?.detail ?? after.phase;
    context.record({
      id: 'start',
      status: 'failed',
      command,
      exitCode: after.processes.find((process) => process.exitCode !== null)?.exitCode ?? null,
      durationMs: Date.now() - Date.parse(session.updatedAt),
      summary: `A process stopped while being checked: ${detail}`.slice(0, 400),
      output: input.output(),
    });
  }
}
