/**
 * Local Run Engine (Phase 13).
 *
 * "Run Project" as one click: materializes a generated project into an
 * OS-tmp workspace, installs dependencies, starts backend and frontend on
 * automatically detected free ports (preferring the generated defaults so
 * dev proxies work unmodified), streams logs through cursor-based ring
 * buffers, and reports localhost URLs. Sessions move through an explicit
 * phase machine (preparing → installing → starting → running, plus
 * stop/restart/failed) and every failure is translated into an actionable
 * diagnosis from the log tail. Child processes are supervised in one
 * registry with a process-exit sweep — a run can fail, NexArch cannot be
 * taken down by it. Public surface: this module definition only.
 */
import type { AppModule } from '../../shared/types/module.js';
import { runnerRouter } from './runner.router.js';

export const runnerModule: AppModule = {
  name: 'runner',
  basePath: '/runner',
  description:
    'One-click local runs: install, start, monitor and stream logs for generated projects',
  router: runnerRouter,
};
