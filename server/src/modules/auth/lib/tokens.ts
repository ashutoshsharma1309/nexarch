/**
 * JWT issue/verify. Access and refresh tokens are both signed with
 * `JWT_SECRET` but carry a `type` claim and are verified against the type
 * the caller expects — so a refresh token can never be replayed as an
 * access token, which is the whole reason the two have different lifetimes.
 */
import jwt from 'jsonwebtoken';
import type { SignOptions } from 'jsonwebtoken';

import { config } from '../../../shared/config/index.js';
import { AppError } from '../../../shared/utils/app-error.js';
import type { AccessTokenPayload, RefreshTokenPayload, RoleName } from '../auth.types.js';

const ISSUER = 'nexarch';

export function signAccessToken(userId: string, role: RoleName): string {
  const payload: AccessTokenPayload = { sub: userId, role, type: 'access' };
  const options = { expiresIn: config.auth.accessTokenTtl, issuer: ISSUER } as SignOptions;
  return jwt.sign(payload, config.auth.jwtSecret, options);
}

export function signRefreshToken(userId: string): string {
  const payload: RefreshTokenPayload = { sub: userId, type: 'refresh' };
  const options = { expiresIn: config.auth.refreshTokenTtl, issuer: ISSUER } as SignOptions;
  return jwt.sign(payload, config.auth.jwtSecret, options);
}

function verify(token: string): Record<string, unknown> {
  try {
    const decoded = jwt.verify(token, config.auth.jwtSecret, { issuer: ISSUER });
    if (typeof decoded === 'string') throw new Error('unexpected token payload');
    return decoded;
  } catch {
    // Never echo the library's reason — "malformed"/"expired"/"bad signature"
    // are all the same answer to a client: this token is not usable.
    throw AppError.unauthorized('Session expired or invalid — sign in again');
  }
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = verify(token);
  if (decoded.type !== 'access' || typeof decoded.sub !== 'string') {
    throw AppError.unauthorized('Session expired or invalid — sign in again');
  }
  return { sub: decoded.sub, role: decoded.role as RoleName, type: 'access' };
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  const decoded = verify(token);
  if (decoded.type !== 'refresh' || typeof decoded.sub !== 'string') {
    throw AppError.unauthorized('Session expired or invalid — sign in again');
  }
  return { sub: decoded.sub, type: 'refresh' };
}
