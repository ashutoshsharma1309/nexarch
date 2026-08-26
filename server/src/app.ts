/**
 * Application assembly.
 *
 * `createApp` wires the middleware pipeline and mounts feature modules —
 * and nothing else. It owns no listening socket and touches no database,
 * which is what makes the app unit-testable with supertest and reusable
 * from serverless adapters later. Process concerns live in `index.ts`.
 *
 * Pipeline order matters and is deliberate:
 *   context → security → parsing (body + cookies) → logging → rate limit →
 *   modules → 404 → errors
 */
import compression from 'compression';
import cookieParser from 'cookie-parser';
import express from 'express';
import type { Express } from 'express';

import { registerModules } from './modules/index.js';
import { config } from './shared/config/index.js';
import { errorHandler, notFoundHandler } from './shared/middleware/error-handler.js';
import { apiRateLimiter } from './shared/middleware/rate-limiter.js';
import { requestContext } from './shared/middleware/request-context.js';
import { requestLogger } from './shared/middleware/request-logger.js';
import { securityMiddleware } from './shared/middleware/security.js';

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  // Behind nginx/ingress in production; needed for correct client IPs in
  // rate limiting and logs. First hop only — never trust arbitrary chains.
  app.set('trust proxy', 1);

  app.use(requestContext);
  app.use(...securityMiddleware());
  app.use(compression());
  // Sessions live in httpOnly cookies, so the pipeline has to parse them
  // before anything can authenticate a request.
  app.use(cookieParser());
  app.use(express.json({ limit: config.server.bodyLimit }));
  app.use(express.urlencoded({ extended: false, limit: config.server.bodyLimit }));
  app.use(requestLogger);

  app.use(config.server.apiPrefix, apiRateLimiter);
  registerModules(app, config.server.apiPrefix);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
