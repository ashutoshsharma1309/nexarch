/**
 * Auth API surface.
 *
 * There is no token in this file, on purpose: the server carries the
 * session in httpOnly cookies, so the browser attaches it automatically
 * and page script can neither read it nor leak it. `withCredentials` is
 * what makes that work — everything else is an ordinary request.
 */
import { apiClient, unwrap } from './api-client';
import type { ApiSuccess, AuthUser } from '@/shared/types/api';

interface SessionPayload {
  user: AuthUser;
}

export interface RegisterPayload {
  name: string;
  email: string;
  password: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export async function register(payload: RegisterPayload): Promise<AuthUser> {
  const { data } = await apiClient.post<ApiSuccess<SessionPayload>>('/auth/register', payload);
  return unwrap(data).user;
}

export async function login(payload: LoginPayload): Promise<AuthUser> {
  const { data } = await apiClient.post<ApiSuccess<SessionPayload>>('/auth/login', payload);
  return unwrap(data).user;
}

export async function logout(): Promise<void> {
  await apiClient.post('/auth/logout');
}

async function me(): Promise<AuthUser> {
  const { data } = await apiClient.get<ApiSuccess<SessionPayload>>('/auth/me');
  return unwrap(data).user;
}

/**
 * Resolves the current session, or null when there isn't one.
 *
 * On a cold load the short-lived access cookie has usually expired while the
 * seven-day refresh cookie has not, so a bare `/auth/me` would report
 * "signed out" to someone who is anything but. The client-wide interceptor
 * deliberately skips `/auth/*` to avoid refresh loops, which is why this one
 * call does the refresh-and-retry itself.
 */
export async function fetchSession(): Promise<AuthUser | null> {
  try {
    return await me();
  } catch {
    try {
      await apiClient.post('/auth/refresh');
      return await me();
    } catch {
      // No usable cookie of either kind — the normal signed-out state, not
      // an error the caller should have to distinguish.
      return null;
    }
  }
}
