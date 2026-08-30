/**
 * POST /api/v1/runner/plan — dry-run: what a run would do (pure, instant).
 * POST /api/v1/runner/sessions — 202 + the new session in `preparing`;
 * phases advance server-side (installing → starting → running | failed)
 * while the client polls the session and its logs.
 * GET  /api/v1/runner/sessions — all sessions, newest first.
 * GET  /api/v1/runner/sessions/:id — one session with processes + transitions.
 * GET  /api/v1/runner/sessions/:id/logs?after=cursor — incremental logs.
 * POST /api/v1/runner/sessions/:id/stop — stop the session's processes.
 * POST /api/v1/runner/sessions/:id/restart — 202; reuses the installed
 * workspace and goes straight back to `starting`.
 */
import { Router } from 'express';

import { requireAuth } from '../auth/index.js';
import { validate } from '../../shared/middleware/validate.js';
import {
  createSessionHandler,
  getSessionHandler,
  listSessionsHandler,
  logsHandler,
  planHandler,
  restartSessionHandler,
  stopSessionHandler,
} from './runner.controller.js';
import { createSessionValidation, logsValidation } from './runner.validator.js';

export const runnerRouter: Router = Router();

// Phase 16: the runner writes files and spawns processes. Every route
// requires an authenticated session, and each session is owned by its
// creator — these endpoints were previously reachable unauthenticated.
runnerRouter.use(requireAuth);

runnerRouter.post('/plan', validate(createSessionValidation), planHandler);
runnerRouter.post('/sessions', validate(createSessionValidation), createSessionHandler);
runnerRouter.get('/sessions', listSessionsHandler);
runnerRouter.get('/sessions/:id', getSessionHandler);
runnerRouter.get('/sessions/:id/logs', validate(logsValidation), logsHandler);
runnerRouter.post('/sessions/:id/stop', stopSessionHandler);
runnerRouter.post('/sessions/:id/restart', restartSessionHandler);
