/**
 * POST /api/v1/builder/sessions            — start a session from a task
 * GET  /api/v1/builder/sessions            — this user's sessions, newest first
 * GET  /api/v1/builder/sessions/:id        — one session: plan, steps, state, result
 * POST /api/v1/builder/sessions/:id/cancel — stop after the current step
 *
 * Same ownership rules as every other route: in no-login mode every request
 * runs as the built-in local user; with accounts on, a session belongs to its
 * creator and anyone else's reads as 404.
 */
import { Router } from 'express';
import { body } from 'express-validator';
import type { Request, Response } from 'express';

import { requireAuth } from '../auth/index.js';
import { expensiveOperationLimiter } from '../../shared/middleware/rate-limiter.js';
import { validate } from '../../shared/middleware/validate.js';
import { sendSuccess } from '../../shared/utils/api-response.js';
import { AppError } from '../../shared/utils/app-error.js';
import { cancelSession, getSession, listSessions, startSession } from './builder-agent.service.js';

function ownerOf(req: Request): string {
  const user = req.user;
  if (!user) throw AppError.internal('builder route reached without an authenticated user');
  return user.id;
}

function idOf(req: Request): string {
  return typeof req.params.id === 'string' ? req.params.id : '';
}

const startValidation = [
  body('task')
    .exists({ values: 'falsy' })
    .withMessage('Describe what to build')
    .bail()
    .isString()
    .bail()
    .trim()
    .isLength({ min: 10, max: 4_000 })
    .withMessage('The task must be 10–4000 characters'),
];

export const builderAgentRouter: Router = Router();

builderAgentRouter.use(requireAuth);

builderAgentRouter.post(
  '/sessions',
  expensiveOperationLimiter,
  validate(startValidation),
  (req: Request, res: Response) => {
    const { task } = req.body as { task: string };
    sendSuccess(res, startSession(ownerOf(req), { task }), { status: 202 });
  },
);
builderAgentRouter.get('/sessions', (req: Request, res: Response) => {
  sendSuccess(res, listSessions(ownerOf(req)));
});
builderAgentRouter.get('/sessions/:id', (req: Request, res: Response) => {
  sendSuccess(res, getSession(idOf(req), ownerOf(req)));
});
builderAgentRouter.post('/sessions/:id/cancel', (req: Request, res: Response) => {
  sendSuccess(res, cancelSession(idOf(req), ownerOf(req)));
});
