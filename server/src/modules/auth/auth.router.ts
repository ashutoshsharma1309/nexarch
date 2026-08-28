/**
 * POST /api/v1/auth/register — create an account, start a session.
 * POST /api/v1/auth/login    — start a session.
 * POST /api/v1/auth/refresh  — rotate the session from the refresh cookie.
 * POST /api/v1/auth/logout   — clear both cookies.
 * GET  /api/v1/auth/me       — the signed-in user, or 401.
 *
 * The credential endpoints get their own, much tighter rate limit than the
 * rest of the API: everything else is a generation call a user makes on
 * purpose, these are the two an attacker would automate.
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';

import { validate } from '../../shared/middleware/validate.js';
import { AppError } from '../../shared/utils/app-error.js';
import {
  loginHandler,
  logoutHandler,
  completeOnboardingHandler,
  meHandler,
  refreshHandler,
  registerHandler,
} from './auth.controller.js';
import { requireAuth } from './auth.middleware.js';
import { loginValidation, registerValidation } from './auth.validator.js';

const credentialLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, next) => {
    next(AppError.rateLimited('Too many attempts — wait a few minutes and try again'));
  },
});

export const authRouter: Router = Router();

authRouter.post('/register', credentialLimiter, validate(registerValidation), (req, res, next) => {
  registerHandler(req, res).catch(next);
});
authRouter.post('/login', credentialLimiter, validate(loginValidation), (req, res, next) => {
  loginHandler(req, res).catch(next);
});
authRouter.post('/refresh', (req, res, next) => {
  refreshHandler(req, res).catch(next);
});
authRouter.post('/logout', logoutHandler);
authRouter.get('/me', requireAuth, meHandler);
authRouter.post('/onboarding/complete', requireAuth, (req, res, next) => {
  completeOnboardingHandler(req, res).catch(next);
});
