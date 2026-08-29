/**
 * Who is responsible for stopping the validation session.
 *
 * The runtime engineer starts a Local Run session and two more agents use
 * it before anyone can say the validation is over — so no single agent can
 * own the stop. The run does: the scheduler calls `releaseValidationSession`
 * when the run settles, whatever it settled as. Step 13's rule is that
 * processes must not outlive the validation, and a rule like that has to
 * live at the level that knows when the validation ends.
 *
 * The registry is deliberately tiny and forgiving: releasing a session
 * that already stopped, or a run that never started one, is a no-op rather
 * than an error. Cleanup that can fail loudly gets skipped in exactly the
 * failure paths where it matters most.
 */
import { logger } from '../../../shared/logger/index.js';
import { getSession, INTERNAL_RUNNER_OWNER, stopSession } from '../../runner/runner.service.js';

const sessionsByRun = new Map<string, string>();

export function registerValidationSession(runId: string, sessionId: string): void {
  sessionsByRun.set(runId, sessionId);
}

export function validationSessionOf(runId: string): string | null {
  return sessionsByRun.get(runId) ?? null;
}

/** Stops the run's session if it is still alive. Safe to call repeatedly. */
export function releaseValidationSession(runId: string): void {
  const sessionId = sessionsByRun.get(runId);
  if (!sessionId) return;
  sessionsByRun.delete(runId);

  try {
    const session = getSession(sessionId, INTERNAL_RUNNER_OWNER);
    if (['running', 'preparing', 'installing', 'starting', 'configuring'].includes(session.phase)) {
      stopSession(sessionId, INTERNAL_RUNNER_OWNER);
      logger.info('validation session released', { runId, sessionId });
    }
  } catch (error) {
    // Already evicted or stopped — the outcome we wanted.
    logger.debug('validation session already gone', { runId, sessionId, error });
  }
}

export function resetValidationSessionsForTests(): void {
  sessionsByRun.clear();
}
