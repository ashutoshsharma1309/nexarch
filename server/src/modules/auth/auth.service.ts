/**
 * Registration, login, refresh, and identity lookup.
 *
 * The service owns the two rules that must never be relaxed: a password is
 * stored only as a bcrypt hash, and a failed login is indistinguishable
 * from an unknown email (same message, same work done). Roles are rows, so
 * `ensureRole` lazily creates the two the platform ships with rather than
 * requiring a seed step before the first signup can succeed.
 */
import { config } from '../../shared/config/index.js';
import { prisma } from '../../shared/database/prisma.js';
import { logger } from '../../shared/logger/index.js';
import { AppError } from '../../shared/utils/app-error.js';
import { completeLocalOnboarding, getLocalUser, LOCAL_USER_ID } from './lib/local-user.js';
import { hashPassword, verifyPassword } from './lib/password.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from './lib/tokens.js';
import type {
  AuthResult,
  AuthUser,
  IssuedTokens,
  LoginInput,
  RegisterInput,
  RoleName,
} from './auth.types.js';

const INVALID_CREDENTIALS = 'Email or password is incorrect';

interface UserRow {
  id: string;
  email: string;
  name: string;
  passwordHash: string | null;
  createdAt: Date;
  onboardedAt: Date | null;
  role: { name: string };
}

function toAuthUser(user: UserRow): AuthUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role.name === 'ADMIN' ? 'ADMIN' : 'USER',
    createdAt: user.createdAt.toISOString(),
    onboardedAt: user.onboardedAt?.toISOString() ?? null,
  };
}

/** Marks the current user's onboarding complete. Idempotent. */
export async function completeOnboarding(userId: string): Promise<AuthUser> {
  if (config.auth.disabled || !config.database.enabled) {
    return completeLocalOnboarding();
  }
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { onboardedAt: new Date() },
    include: { role: true },
  });
  return toAuthUser(updated);
}

/** Roles are a table, not an enum — so the first signup has to be able to create the row it needs. */
async function ensureRole(name: RoleName): Promise<string> {
  const existing = await prisma.role.findUnique({ where: { name } });
  if (existing) return existing.id;

  const created = await prisma.role.create({
    data: {
      name,
      description: name === 'ADMIN' ? 'Full platform access' : 'Standard platform access',
    },
  });
  return created.id;
}

function issueTokens(user: AuthUser): IssuedTokens {
  return {
    accessToken: signAccessToken(user.id, user.role),
    refreshToken: signRefreshToken(user.id),
  };
}

/** Real accounts are off in no-auth mode; every request is already the local user. */
function assertAuthEnabled(): void {
  if (config.auth.disabled) {
    throw AppError.badRequest('Authentication is disabled — the app runs as a single local user');
  }
}

export async function register(input: RegisterInput): Promise<AuthResult> {
  assertAuthEnabled();
  const email = input.email.trim().toLowerCase();

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw AppError.conflict('An account with that email already exists', [
      { field: 'email', message: 'Already registered' },
    ]);
  }

  // The very first account owns the install; everyone after is a standard user.
  const isFirstUser = (await prisma.user.count()) === 0;
  const roleName: RoleName = isFirstUser ? 'ADMIN' : 'USER';
  const roleId = await ensureRole(roleName);

  const created = await prisma.user.create({
    data: {
      email,
      name: input.name.trim(),
      passwordHash: await hashPassword(input.password),
      roleId,
    },
    include: { role: true },
  });

  const user = toAuthUser(created);
  logger.info('account created', { userId: user.id, role: user.role });
  return { user, tokens: issueTokens(user) };
}

export async function login(input: LoginInput): Promise<AuthResult> {
  assertAuthEnabled();
  const email = input.email.trim().toLowerCase();
  const found = await prisma.user.findUnique({ where: { email }, include: { role: true } });

  // `verifyPassword` runs a bcrypt comparison even when `found` is null, so
  // an unknown email costs the same wall-clock as a wrong password.
  const ok = await verifyPassword(input.password, found?.passwordHash ?? null);
  if (!found || !ok) {
    logger.warn('failed sign-in attempt', { email });
    throw AppError.unauthorized(INVALID_CREDENTIALS);
  }

  const user = toAuthUser(found);
  logger.info('sign-in', { userId: user.id });
  return { user, tokens: issueTokens(user) };
}

export async function refresh(refreshToken: string): Promise<AuthResult> {
  assertAuthEnabled();
  const payload = verifyRefreshToken(refreshToken);
  const found = await prisma.user.findUnique({
    where: { id: payload.sub },
    include: { role: true },
  });
  if (!found) throw AppError.unauthorized('Session expired or invalid — sign in again');

  const user = toAuthUser(found);
  return { user, tokens: issueTokens(user) };
}

export async function findUserById(id: string): Promise<AuthUser | null> {
  if (config.auth.disabled) return id === LOCAL_USER_ID ? getLocalUser() : null;
  const found = await prisma.user.findUnique({ where: { id }, include: { role: true } });
  return found ? toAuthUser(found) : null;
}
