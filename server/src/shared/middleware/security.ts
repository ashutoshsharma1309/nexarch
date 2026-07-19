/**
 * Edge security: Helmet header hardening + strict-allow-list CORS.
 *
 * The API serves JSON only, so Helmet's defaults (no-sniff, frame denial,
 * HSTS in production, cross-origin resource policy) apply cleanly. CORS is
 * deny-by-default: an origin absent from `config.cors.origins` gets no CORS
 * headers at all rather than an error response — the browser enforces the
 * rest.
 */
import cors from 'cors';
import helmet from 'helmet';
import type { RequestHandler } from 'express';

import { config } from '../config/index.js';

export function securityMiddleware(): RequestHandler[] {
  const helmetMiddleware = helmet({
    // A JSON API never renders HTML; a restrictive CSP is still cheap
    // defense-in-depth for error pages and future served content.
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
  });

  const corsMiddleware = cors({
    origin: (origin, callback) => {
      // Non-browser clients (curl, server-to-server) send no Origin header
      // and are not subject to CORS.
      const allowed = origin === undefined || config.cors.origins.includes(origin);
      callback(null, allowed);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 86_400,
  });

  return [helmetMiddleware, corsMiddleware];
}
