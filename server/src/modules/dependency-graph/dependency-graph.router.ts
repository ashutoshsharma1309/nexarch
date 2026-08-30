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
 * POST /api/v1/dependency/diff
 *
 * Same core bundle plus `newRequirements` (the spec a NEW prompt analyzed
 * into). Diffs it against `requirements` (the spec the current project was
 * built from), synthesizes change requests from the structured diff, and
 * returns a SpecDiffAnalysis: what changed, what it impacts, and a
 * selective regeneration plan (or a full-rebuild recommendation when the
 * diff is too broad for selective merge to pay off).
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
  specDiffHandler,
  statisticsHandler,
} from './dependency-graph.controller.js';
import {
  changeRequestValidation,
  graphInputsValidation,
  regenerateValidation,
  specDiffValidation,
} from './dependency-graph.validator.js';

import { requireAuth } from '../auth/index.js';

export const dependencyGraphRouter: Router = Router();

// Phase 16: every route here requires an authenticated session.
// These endpoints were reachable unauthenticated; a release build must
// not expose compute or data to anonymous callers.
dependencyGraphRouter.use(requireAuth);

dependencyGraphRouter.post('/build', validate(graphInputsValidation), buildHandler);
dependencyGraphRouter.post(
  '/analyze',
  validate([...graphInputsValidation, ...changeRequestValidation]),
  analyzeHandler,
);
dependencyGraphRouter.post(
  '/diff',
  validate([...graphInputsValidation, ...specDiffValidation]),
  specDiffHandler,
);
dependencyGraphRouter.post(
  '/regenerate',
  validate([...graphInputsValidation, ...changeRequestValidation, ...regenerateValidation]),
  regenerateHandler,
);
dependencyGraphRouter.get('/graph', graphHandler);
dependencyGraphRouter.get('/statistics', statisticsHandler);
