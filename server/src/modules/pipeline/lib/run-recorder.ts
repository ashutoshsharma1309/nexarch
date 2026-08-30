/**
 * Writes the durable half of a run.
 *
 * Subscribes to the generation engine's lifecycle events and mirrors them
 * into the `generations` table: a row on `started`, its terminal status on
 * `settled`. Nothing here can fail a run — every write is best-effort and a
 * failure is a warning, because an unrecorded run is a gap in history while
 * a lost run is a user's work thrown away.
 *
 * Wired once, in the module's `index.ts`. The engine itself has no idea
 * this exists.
 */
import { logger } from '../../../shared/logger/index.js';
import { observeRuns } from '../pipeline.service.js';
import { closeRun, openRun } from './run-store.js';
import type { PipelineRun, RunPhase } from '../pipeline.types.js';

let wired = false;

export function wireRunRecorder(): void {
  if (wired) return;
  wired = true;

  observeRuns((run: PipelineRun, phase: RunPhase) => {
    // A run started outside the API (a test, a script) has no project to
    // belong to; there is nothing to record and that is not an error.
    if (run.projectId === null) return;

    if (phase === 'started') {
      void openRun(run.id, run.projectId, run.prompt).catch((error: unknown) => {
        logger.warn('run record could not be opened', { runId: run.id, error });
      });
      return;
    }

    void closeRun(run.id, run.status === 'completed' ? 'COMPLETED' : 'FAILED', run.error).catch(
      (error: unknown) => {
        logger.warn('run record could not be closed', { runId: run.id, error });
      },
    );
  });
}
