/**
 * GET /api/v1/projects/:projectId/graph                          — the whole graph (optional ?type=)
 * GET /api/v1/projects/:projectId/graph/validate                 — structural report
 * GET /api/v1/projects/:projectId/graph/lookup?identity=         — one node, by identity rather than id
 * GET /api/v1/projects/:projectId/graph/nodes/:nodeId            — node + its neighbourhood
 * GET /api/v1/projects/:projectId/graph/nodes/:nodeId/dependencies
 * GET /api/v1/projects/:projectId/graph/nodes/:nodeId/dependents
 * GET /api/v1/projects/:projectId/graph/nodes/:nodeId/path?to=   — shortest chain between two nodes
 * GET /api/v1/projects/:projectId/graph/nodes/:nodeId/trace      — requirement ⇄ code, with evidence
 * GET /api/v1/projects/:projectId/graph/impact/:nodeId           — what a change here touches
 *
 * `:nodeId` is a database id or a node identity (`FILE::backend/src/app.ts`,
 * percent-encoded), and `lookup` takes the same identity as a query so a
 * caller holding only a file path never has to download the graph to find
 * the id. Both forms resolve through the same code the builder uses.
 *
 * The graph describes a user's project, so the whole subtree sits behind
 * `requireAuth` and every handler re-resolves the project through the
 * caller's id. `validate` and `lookup` are registered before `nodes/:nodeId`
 * so the literals are never read as ids.
 */
import { Router } from 'express';

import { requireAuth } from '../auth/index.js';
import {
  dependenciesHandler,
  dependentsHandler,
  graphHandler,
  impactHandler,
  lookupHandler,
  nodeHandler,
  pathHandler,
  refreshHandler,
  traceHandler,
  validateHandler,
} from './engineering-graph.controller.js';

export const engineeringGraphRouter: Router = Router();

engineeringGraphRouter.use(requireAuth);

engineeringGraphRouter.get('/:projectId/graph', graphHandler);
engineeringGraphRouter.get('/:projectId/graph/validate', validateHandler);
engineeringGraphRouter.get('/:projectId/graph/lookup', lookupHandler);
engineeringGraphRouter.post('/:projectId/graph/refresh', refreshHandler);
engineeringGraphRouter.get('/:projectId/graph/nodes/:nodeId', nodeHandler);
engineeringGraphRouter.get('/:projectId/graph/nodes/:nodeId/dependencies', dependenciesHandler);
engineeringGraphRouter.get('/:projectId/graph/nodes/:nodeId/dependents', dependentsHandler);
engineeringGraphRouter.get('/:projectId/graph/nodes/:nodeId/path', pathHandler);
engineeringGraphRouter.get('/:projectId/graph/nodes/:nodeId/trace', traceHandler);
engineeringGraphRouter.get('/:projectId/graph/impact/:nodeId', impactHandler);
