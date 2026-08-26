/**
 * Auth contracts. The client only ever sees `AuthUser` — never a password
 * hash, never a raw token payload, never the refresh token's contents.
 */

export type RoleName = 'ADMIN' | 'USER';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: RoleName;
  createdAt: string;
}

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

/** What a verified access token carries. Nothing sensitive: an id, a role, an expiry. */
export interface AccessTokenPayload {
  sub: string;
  role: RoleName;
  type: 'access';
}

export interface RefreshTokenPayload {
  sub: string;
  type: 'refresh';
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResult {
  user: AuthUser;
  tokens: IssuedTokens;
}
