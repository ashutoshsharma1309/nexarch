/**
 * GET /api/v1/projects/:projectId/graph                          — the whole graph (optional ?type=)
 * GET /api/v1/projects/:projectId/graph/validate                 — structural report
 * GET /api/v1/projects/:projectId/graph/nodes/:nodeId            — node + its neighbourhood
 * GET /api/v1/projects/:projectId/graph/nodes/:nodeId/dependencies
 * GET /api/v1/projects/:projectId/graph/nodes/:nodeId/dependents
 * GET /api/v1/projects/:projectId/graph/nodes/:nodeId/path?to=   — shortest chain between two nodes
 * GET /api/v1/projects/:projectId/graph/impact/:nodeId           — what a change here touches
 *
 * The graph describes a user's project, so the whole subtree sits behind
 * `requireAuth` and every handler re-resolves the project through the
 * caller's id. `validate` is registered before `nodes/:nodeId` so the
 * literal is never read as an id.
 */
import { Router } from 'express';

import { requireAuth } from '../auth/index.js';
import {
  dependenciesHandler,
  dependentsHandler,
  graphHandler,
  impactHandler,
  nodeHandler,
  pathHandler,
  validateHandler,
} from './engineering-graph.controller.js';

export const engineeringGraphRouter: Router = Router();

engineeringGraphRouter.use(requireAuth);

engineeringGraphRouter.get('/:projectId/graph', graphHandler);
engineeringGraphRouter.get('/:projectId/graph/validate', validateHandler);
engineeringGraphRouter.get('/:projectId/graph/nodes/:nodeId', nodeHandler);
engineeringGraphRouter.get('/:projectId/graph/nodes/:nodeId/dependencies', dependenciesHandler);
engineeringGraphRouter.get('/:projectId/graph/nodes/:nodeId/dependents', dependentsHandler);
engineeringGraphRouter.get('/:projectId/graph/nodes/:nodeId/path', pathHandler);
engineeringGraphRouter.get('/:projectId/graph/impact/:nodeId', impactHandler);
