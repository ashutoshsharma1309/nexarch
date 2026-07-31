/**
 * GET  /api/v1/github/status — integration state (never touches the network).
 * GET  /api/v1/github/user — the authenticated GitHub user.
 * GET  /api/v1/github/repositories — the user's repositories.
 * POST /api/v1/github/repositories — create a repository.
 * GET  /api/v1/github/repositories/:owner/:repo — one repository.
 * GET  /api/v1/github/repositories/:owner/:repo/commits?branch= — history.
 * POST /api/v1/github/branches — create a branch.
 * POST /api/v1/github/push/plan — dry-run of a push (works without a token).
 * POST /api/v1/github/push — commit + push files via the Git Data API.
 *
 * Everything except /status and /push/plan requires GITHUB_TOKEN; without
 * it those endpoints answer 403 with the enable path spelled out.
 */
import { Router } from 'express';

import { validate } from '../../shared/middleware/validate.js';
import {
  commitsHandler,
  createBranchHandler,
  createRepoHandler,
  getRepoHandler,
  listReposHandler,
  pushHandler,
  pushPlanHandler,
  statusHandler,
  userHandler,
} from './github.controller.js';
import {
  createBranchValidation,
  createRepoValidation,
  pushValidation,
  repoParamsValidation,
} from './github.validator.js';

export const githubRouter: Router = Router();

githubRouter.get('/status', statusHandler);
githubRouter.get('/user', userHandler);
githubRouter.get('/repositories', listReposHandler);
githubRouter.post('/repositories', validate(createRepoValidation), createRepoHandler);
githubRouter.get('/repositories/:owner/:repo', validate(repoParamsValidation), getRepoHandler);
githubRouter.get(
  '/repositories/:owner/:repo/commits',
  validate(repoParamsValidation),
  commitsHandler,
);
githubRouter.post('/branches', validate(createBranchValidation), createBranchHandler);
githubRouter.post('/push/plan', validate(pushValidation), pushPlanHandler);
githubRouter.post('/push', validate(pushValidation), pushHandler);
