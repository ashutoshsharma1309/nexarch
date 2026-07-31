/**
 * Controller. `build`/`analyze`/`regenerate` are stateless — every call
 * re-derives its result from the full request body. `GET /graph` and
 * `GET /statistics` can't carry a body, so they serve the most recently
 * built graph from an in-memory cache (the same "most recent in this
 * process" continuity model the Security Engine's report cache uses).
 */
import type { Request, Response } from 'express';

import { AppError } from '../../shared/utils/app-error.js';
import { sendSuccess } from '../../shared/utils/api-response.js';
import {
  analyzeChangeImpact,
  analyzeSpecDiff,
  buildDependencyGraphBundle,
  regenerateProject,
} from './dependency-graph.service.js';
import type { BuildResult } from './dependency-graph.service.js';
import {
  readAnalyzeRequest,
  readBuildRequest,
  readRegenerateRequest,
  readSpecDiffRequest,
} from './dependency-graph.validator.js';

let lastBuild: BuildResult | null = null;

export function buildHandler(req: Request, res: Response): void {
  const inputs = readBuildRequest(req.body as Record<string, unknown>);
  const result = buildDependencyGraphBundle(inputs);
  lastBuild = result;
  sendSuccess(res, result.bundle);
}

export function analyzeHandler(req: Request, res: Response): void {
  const inputs = readAnalyzeRequest(req.body as Record<string, unknown>);
  const impact = analyzeChangeImpact(inputs.changeRequest, inputs);
  sendSuccess(res, impact);
}

export function specDiffHandler(req: Request, res: Response): void {
  const inputs = readSpecDiffRequest(req.body as Record<string, unknown>);
  const analysis = analyzeSpecDiff(inputs.newRequirements, inputs);
  sendSuccess(res, analysis);
}

export function regenerateHandler(req: Request, res: Response): void {
  const inputs = readRegenerateRequest(req.body as Record<string, unknown>);
  const result = regenerateProject(inputs);
  sendSuccess(res, result);
}

export function graphHandler(_req: Request, res: Response): void {
  if (!lastBuild) {
    throw AppError.notFound(
      'No dependency graph has been built yet — call POST /dependency/build first',
    );
  }
  sendSuccess(res, lastBuild.bundle.graph);
}

export function statisticsHandler(_req: Request, res: Response): void {
  if (!lastBuild) {
    throw AppError.notFound(
      'No dependency graph has been built yet — call POST /dependency/build first',
    );
  }
  sendSuccess(res, lastBuild.bundle.stats);
}
