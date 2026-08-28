/**
 * `requireAuth` — the one gate other modules mount in front of protected
 * routes. It accepts the session cookie the browser client uses and a
 * `Authorization: Bearer` header for non-browser callers, resolves the
 * token to a real user row (so a deleted account's still-valid token stops
 * working immediately), and hangs the result on `req.user`.
 */
import type { RequestHandler } from 'express';

import { config } from '../../shared/config/index.js';
import { AppError } from '../../shared/utils/app-error.js';
import { findUserById } from './auth.service.js';
import { ACCESS_COOKIE } from './lib/cookies.js';
import { getLocalUser } from './lib/local-user.js';
import { verifyAccessToken } from './lib/tokens.js';
import type { RoleName } from './auth.types.js';

function readToken(req: Parameters<RequestHandler>[0]): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim() || null;
  const cookies = req.cookies as Record<string, string> | undefined;
  return cookies?.[ACCESS_COOKIE] ?? null;
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  // No-auth mode: every request runs as the single built-in local user.
  if (config.auth.disabled) {
    req.user = getLocalUser();
    next();
    return;
  }
  void (async () => {
    try {
      const token = readToken(req);
      if (!token) throw AppError.unauthorized('Sign in to continue');

      const payload = verifyAccessToken(token);
      const user = await findUserById(payload.sub);
      if (!user) throw AppError.unauthorized('Sign in to continue');

      req.user = user;
      next();
    } catch (error) {
      next(error);
    }
  })();
};

/** Role gate. Mount after `requireAuth` — it reads the user that middleware resolved. */
export function requireRole(...roles: RoleName[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) {
      next(AppError.unauthorized('Sign in to continue'));
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(AppError.forbidden(`This action requires the ${roles.join(' or ')} role`));
      return;
    }
    next();
  };
}
