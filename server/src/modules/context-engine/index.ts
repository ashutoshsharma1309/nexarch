/**
 * Context Engine — the bridge between the Engineering Graph and the model.
 *
 * NexArch decides what is relevant *before* the call. The model is never
 * handed the project and asked to work out what it needs, because that
 * pays for the whole project on every request and still gives the model a
 * needle-in-haystack problem it is not reliable at.
 *
 * Mounted under `/projects` so its routes read
 * `/projects/:projectId/context`, matching the project-centric shape the
 * rest of v2 uses.
 */
import type { AppModule } from '../../shared/types/module.js';
import { contextEngineRouter } from './context-engine.router.js';

export { buildContext, buildContextWithFallback } from './context-engine.service.js';
export { runBenchmark } from './lib/benchmark.js';

export const contextEngineModule: AppModule = {
  name: 'context-engine',
  basePath: '/projects',
  description: 'Graph-driven context selection, token budgeting and compilation for AI tasks',
  router: contextEngineRouter,
};
