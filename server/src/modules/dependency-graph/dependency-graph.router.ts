/**
 * POST /api/v1/dependency/build
 *
 * Body: { requirements, architecture, databaseDesign, backend, frontend,
 *         security } — the artifacts from Phases 2-7. Returns a
 * DependencyGraphBundle: the graph, its visualization layout, statistics,
 * and quality report.
 *
 * POST /api/v1/dependency/analyze
 *
 * Same body plus `changeRequest` (a natural-language description of the
 * desired change, e.g. "Add Google Login"). Returns an ImpactAnalysis:
 * which nodes/files the change touches and the estimated token savings
 * versus regenerating the whole project.
 *
 * POST /api/v1/dependency/regenerate
 *
 * Same body plus `changeRequest`, `newBackend`/`newFrontend`/`newSecurity`
 * (the bundles produced by re-running Phases 5-7 with the updated design),
 * and an optional `manualEdits` path→content map. Returns a
 * RegenerationResult: the merged file set (only impacted files replaced,
 * manual edits always preserved) and the updated project-manifest.json.
 *
 * GET /api/v1/dependency/graph
 * GET /api/v1/dependency/statistics
 *
 * Serve the most recently built graph/statistics (404 if build hasn't run
 * yet in this process).
 */
import { Router } from 'express';

import { validate } from '../../shared/middleware/validate.js';
import {
  analyzeHandler,
  buildHandler,
  graphHandler,
  regenerateHandler,
  statisticsHandler,
} from './dependency-graph.controller.js';
import {
  changeRequestValidation,
  graphInputsValidation,
  regenerateValidation,
} from './dependency-graph.validator.js';

export const dependencyGraphRouter: Router = Router();

dependencyGraphRouter.post('/build', validate(graphInputsValidation), buildHandler);
dependencyGraphRouter.post(
  '/analyze',
  validate([...graphInputsValidation, ...changeRequestValidation]),
  analyzeHandler,
);
dependencyGraphRouter.post(
  '/regenerate',
  validate([...graphInputsValidation, ...changeRequestValidation, ...regenerateValidation]),
  regenerateHandler,
);
dependencyGraphRouter.get('/graph', graphHandler);
dependencyGraphRouter.get('/statistics', statisticsHandler);
