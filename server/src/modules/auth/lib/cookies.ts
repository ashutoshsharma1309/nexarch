/**
 * Session cookies.
 *
 * The tokens live in httpOnly cookies rather than localStorage: script on
 * the page cannot read them, so an XSS bug in the console can't walk off
 * with a session. `sameSite: lax` is enough because the client is served
 * same-origin (Vite proxies `/api` in dev, nginx in production), and the
 * refresh cookie is scoped to the refresh endpoint so it is never sent on
 * an ordinary API call.
 */
import type { Response } from 'express';

import { config } from '../../../shared/config/index.js';
import type { IssuedTokens } from '../auth.types.js';

export const ACCESS_COOKIE = 'nexarch_session';
export const REFRESH_COOKIE = 'nexarch_refresh';

const REFRESH_PATH = `${config.server.apiPrefix}/auth`;

const ACCESS_MAX_AGE_MS = 15 * 60 * 1000;
const REFRESH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function base(): { httpOnly: true; sameSite: 'lax'; secure: boolean } {
  return { httpOnly: true, sameSite: 'lax', secure: config.isProduction };
}

export function setAuthCookies(res: Response, tokens: IssuedTokens): void {
  res.cookie(ACCESS_COOKIE, tokens.accessToken, {
    ...base(),
    path: '/',
    maxAge: ACCESS_MAX_AGE_MS,
  });
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...base(),
    path: REFRESH_PATH,
    maxAge: REFRESH_MAX_AGE_MS,
  });
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, { ...base(), path: '/' });
  res.clearCookie(REFRESH_COOKIE, { ...base(), path: REFRESH_PATH });
}
