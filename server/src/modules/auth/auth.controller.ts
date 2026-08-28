/**
 * HTTP translation for the credential endpoints. Tokens leave this module
 * only as httpOnly cookies — the response body carries the user and nothing
 * else, so no token ever reaches page script.
 */
import type { Request, Response } from 'express';

import { sendSuccess } from '../../shared/utils/api-response.js';
import { AppError } from '../../shared/utils/app-error.js';
import { completeOnboarding, login, refresh, register } from './auth.service.js';
import { audit } from '../../shared/security/audit.js';
import { clearAuthCookies, REFRESH_COOKIE, setAuthCookies } from './lib/cookies.js';
import type { LoginInput, RegisterInput } from './auth.types.js';

export async function registerHandler(req: Request, res: Response): Promise<void> {
  const result = await register(req.body as RegisterInput);
  setAuthCookies(res, result.tokens);
  audit('SIGNUP', { userId: result.user.id, requestId: req.id });
  sendSuccess(res, { user: result.user }, { status: 201 });
}

export async function loginHandler(req: Request, res: Response): Promise<void> {
  // A failed login throws before the audit line — the catch in the error
  // pipeline never sees the password, and neither does this event.
  try {
    const result = await login(req.body as LoginInput);
    setAuthCookies(res, result.tokens);
    audit('LOGIN_SUCCESS', { userId: result.user.id, requestId: req.id });
    sendSuccess(res, { user: result.user });
  } catch (error) {
    // No email, no password — only that an attempt failed, for the record.
    audit('LOGIN_FAILURE', { requestId: req.id });
    throw error;
  }
}

export async function refreshHandler(req: Request, res: Response): Promise<void> {
  const cookies = req.cookies as Record<string, string> | undefined;
  const token = cookies?.[REFRESH_COOKIE];
  if (!token) throw AppError.unauthorized('No session to refresh');

  const result = await refresh(token);
  setAuthCookies(res, result.tokens);
  sendSuccess(res, { user: result.user });
}

export function logoutHandler(req: Request, res: Response): void {
  clearAuthCookies(res);
  audit('LOGOUT', { userId: req.user?.id ?? null, requestId: req.id });
  sendSuccess(res, { signedOut: true });
}

export function meHandler(req: Request, res: Response): void {
  sendSuccess(res, { user: req.user });
}

export async function completeOnboardingHandler(req: Request, res: Response): Promise<void> {
  const user = req.user;
  if (!user) throw AppError.unauthorized('Sign in to continue');
  const updated = await completeOnboarding(user.id);
  sendSuccess(res, { user: updated });
}
