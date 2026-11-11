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
import { ensureLocalUserRecord, findUserById } from './auth.service.js';
import { isLoopbackHost, isLoopbackPeer, noAuthRefusal } from './lib/auth-mode.js';
import { ACCESS_COOKIE } from './lib/cookies.js';
import { getLocalUser } from './lib/local-user.js';
import { verifyAccessToken } from './lib/tokens.js';
import type { RoleName } from './auth.types.js';
import { setLogContext } from '../../shared/logger/context.js';

// At load, like the JWT_SECRET guard in config: every protected route imports
// this file, so a production server cannot come up in no-auth mode.
const refusal = noAuthRefusal({
  disabled: config.auth.disabled,
  isProduction: config.isProduction,
});
if (refusal !== null) {
  process.stderr.write(refusal);
  process.exit(1);
}

function readToken(req: Parameters<RequestHandler>[0]): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim() || null;
  const cookies = req.cookies as Record<string, string> | undefined;
  return cookies?.[ACCESS_COOKIE] ?? null;
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  // No-auth mode: every request runs as the single built-in local user.
  if (config.auth.disabled) {
    if (!isLoopbackPeer(req.socket.remoteAddress)) {
      next(
        AppError.forbidden(
          'This server has login turned off, so it only answers requests from its own machine. Set AUTH_DISABLED=false to allow remote access.',
        ),
      );
      return;
    }
    // The peer is the browser's machine under DNS rebinding, so only the name
    // it thinks it is talking to can tell a local page from a hostile one.
    if (!isLoopbackHost(req.headers.host)) {
      next(
        AppError.forbidden(
          'This server has login turned off, so it only answers requests addressed to localhost.',
        ),
      );
      return;
    }
    req.user = getLocalUser();
    // The correlation context was opened several middlewares ago, before
    // anyone knew who was asking; `setLogContext` exists for exactly this.
    setLogContext({ userId: req.user.id });
    // With a database, the local user must exist as a row to own projects.
    ensureLocalUserRecord().then(() => {
      next();
    }, next);
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
      setLogContext({ userId: user.id });
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
