/**
 * Execution Events — the ordered, durable record of what a job really did.
 *
 * Mounted at `/projects` beside the graph and edits. Code that publishes
 * events imports `execution-events.service.js` directly: this file also
 * loads the router, which depends on the pipeline that publishes.
 */
import type { AppModule } from '../../shared/types/module.js';
import { executionEventsRouter } from './execution-events.router.js';

export const executionEventsModule: AppModule = {
  name: 'execution-events',
  basePath: '/projects',
  description:
    'Ordered execution history, live streams and per-stage usage for runs and enhancements',
  router: executionEventsRouter,
};
