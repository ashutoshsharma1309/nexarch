/**
 * POST /api/v1/projects/:projectId/context           — compile a context and return it
 * POST /api/v1/projects/:projectId/context/trace     — the same, without the body
 * POST /api/v1/projects/:projectId/context/benchmark — full vs selective, measured
 * GET  /api/v1/projects/:projectId/context/stats     — tokenizer accuracy, cache size
 *
 * POST rather than GET for the first three: a context request carries
 * arrays and nested options that do not belong in a query string, and the
 * call is a computation rather than a resource fetch.
 *
 * Every route resolves the project through the caller, so one user can
 * never compile context from another's graph.
 */
import { Router } from 'express';

import { requireAuth } from '../auth/index.js';
import {
  benchmarkHandler,
  inspectHandler,
  statsHandler,
  traceHandler,
} from './context-engine.controller.js';

export const contextEngineRouter: Router = Router();

contextEngineRouter.use(requireAuth);

contextEngineRouter.get('/:projectId/context/stats', statsHandler);
contextEngineRouter.post('/:projectId/context/trace', traceHandler);
contextEngineRouter.post('/:projectId/context/benchmark', benchmarkHandler);
contextEngineRouter.post('/:projectId/context', inspectHandler);
