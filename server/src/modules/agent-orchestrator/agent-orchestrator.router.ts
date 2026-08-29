/**
 * POST /api/v1/projects/:projectId/agent-runs              — plan and start a run
 * GET  /api/v1/projects/:projectId/agent-runs              — this owner's runs
 * GET  /api/v1/projects/:projectId/agent-runs/agents       — the agent catalogue
 * GET  /api/v1/projects/:projectId/agent-runs/:runId       — run + derived progress
 * GET  /api/v1/projects/:projectId/agent-runs/:runId/tasks — task state
 * GET  /api/v1/projects/:projectId/agent-runs/:runId/events?after=  — the event log
 * POST /api/v1/projects/:projectId/agent-runs/:runId/cancel
 * POST /api/v1/projects/:projectId/agent-runs/:runId/resume
 *
 * A separate surface from `/pipeline/runs` rather than a mode flag on it:
 * the legacy pipeline keeps working untouched, and the two can be compared
 * against each other while the migration proceeds one agent at a time.
 *
 * `agents` is registered before `:runId` so the literal is never read as an id.
 */
import { Router } from 'express';

import { requireAuth } from '../auth/index.js';
import { expensiveOperationLimiter } from '../../shared/middleware/rate-limiter.js';
import {
  agentsHandler,
  cancelHandler,
  artifactByTypeHandler,
  artifactsHandler,
  engineeringReviewHandler,
  eventsHandler,
  findingHandler,
  findingsHandler,
  intelligenceSummaryHandler,
  projectFilesHandler,
  repairDetailHandler,
  repairsHandler,
  startRepairsHandler,
  updateFindingHandler,
  validationHandler,
  getHandler,
  listHandler,
  resumeHandler,
  startHandler,
  tasksHandler,
} from './agent-orchestrator.controller.js';

export const agentOrchestratorRouter: Router = Router();

agentOrchestratorRouter.use(requireAuth);

agentOrchestratorRouter.post('/:projectId/agent-runs', expensiveOperationLimiter, startHandler);
agentOrchestratorRouter.get('/:projectId/agent-runs', listHandler);
agentOrchestratorRouter.get('/:projectId/agent-runs/agents', agentsHandler);
agentOrchestratorRouter.get('/:projectId/agent-runs/:runId', getHandler);
agentOrchestratorRouter.get('/:projectId/agent-runs/:runId/tasks', tasksHandler);
agentOrchestratorRouter.get('/:projectId/agent-runs/:runId/events', eventsHandler);
// `project-files` is registered before `:type` so it is read as the literal it is.
// Exactly one handler: the extra handlers that were mistakenly chained here
// (repairs/update-finding/validation — several of them mutating) never fired
// only because this one terminates the response, but a GET route must never be
// wired to mutation handlers in the first place (Phase 16 fix).
agentOrchestratorRouter.get(
  '/:projectId/agent-runs/:runId/artifacts/project-files',
  projectFilesHandler,
);
agentOrchestratorRouter.get('/:projectId/agent-runs/:runId/artifacts', artifactsHandler);
agentOrchestratorRouter.get('/:projectId/agent-runs/:runId/artifacts/:type', artifactByTypeHandler);
// Findings and the engineering review live at project scope: they outlive
// the runs that observed them.
agentOrchestratorRouter.get('/:projectId/findings', findingsHandler);
agentOrchestratorRouter.get('/:projectId/findings/:findingId', findingHandler);
agentOrchestratorRouter.patch('/:projectId/findings/:findingId', updateFindingHandler);
agentOrchestratorRouter.get('/:projectId/engineering-review', engineeringReviewHandler);
agentOrchestratorRouter.get('/:projectId/validation', validationHandler);
agentOrchestratorRouter.get('/:projectId/intelligence/summary', intelligenceSummaryHandler);
agentOrchestratorRouter.post('/:projectId/repairs', expensiveOperationLimiter, startRepairsHandler);
agentOrchestratorRouter.get('/:projectId/repairs', repairsHandler);
agentOrchestratorRouter.get('/:projectId/repairs/:repairId', repairDetailHandler);
agentOrchestratorRouter.post('/:projectId/agent-runs/:runId/cancel', cancelHandler);
agentOrchestratorRouter.post('/:projectId/agent-runs/:runId/resume', resumeHandler);
