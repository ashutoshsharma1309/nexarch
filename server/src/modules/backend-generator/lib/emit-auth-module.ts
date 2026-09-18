/**
 * Emits a working authentication module instead of a stub.
 *
 * Every generated project already had the pieces for authentication: a user
 * table with a unique email and a password-hash column, routes wired to
 * `/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout` and
 * `/auth/me`, a `JWT_SECRET` validated at boot, and a frontend whose first
 * screen is a sign-in form posting to those paths. The only missing piece
 * was the implementation: the controller threw `NotImplementedError`, so
 * every generated application answered its own login form with 501 and no
 * one could get past the front door. A generated app whose first screen
 * cannot work is not a generated app.
 *
 * What is generated here is deliberately ordinary: bcrypt for hashing,
 * a signed JWT for the session, the user row read through the same Prisma
 * client every other module uses. The field names are read from the design
 * rather than assumed, so a project whose user table is called something
 * else still authenticates against the right columns.
 */
import type { ColumnDesign, TableDesign } from '../../../shared/types/design.js';
import type { GeneratedFile } from '../backend-generator.types.js';
import { file } from './file-tree.js';
import type { ModuleModel } from './project-model.js';

const SERVER_MANAGED = new Set(['id', 'created_at', 'updated_at', 'deleted_at']);

/** The columns authentication needs, resolved from the design's own names. */
export interface CredentialModel {
  table: TableDesign;
  /** Prisma model accessor, e.g. `users`. */
  modelProp: string;
  emailField: string;
  passwordField: string;
  nameField: string | null;
  roleField: string | null;
  softDelete: boolean;
  /** Other columns a row cannot be created without. */
  extraRequired: ColumnDesign[];
}

function looksLikeEmail(column: ColumnDesign): boolean {
  return column.unique && /email/i.test(column.name);
}

function looksLikePassword(column: ColumnDesign): boolean {
  return /password/i.test(column.name) && column.prismaType === 'String';
}

/**
 * The table an application authenticates against, or null when the design
 * has none. Requires both a unique email and a password column: a table
 * with only one of them cannot verify a credential, and guessing would
 * generate an auth module that compiles and then rejects everyone.
 */
export function credentialTableOf(tables: TableDesign[]): CredentialModel | null {
  for (const table of tables) {
    const email = table.columns.find(looksLikeEmail);
    const password = table.columns.find(looksLikePassword);
    if (!email || !password) continue;

    const name = table.columns.find((c) => c.name === 'name' || c.name === 'full_name');
    const role = table.columns.find((c) => c.name === 'role' || c.name === 'roles');
    const extraRequired = table.columns.filter(
      (c) =>
        !SERVER_MANAGED.has(c.name) &&
        c !== email &&
        c !== password &&
        c !== name &&
        c !== role &&
        !c.nullable &&
        c.defaultExpression === undefined &&
        c.enumValues === undefined &&
        c.prismaType === 'String',
    );

    return {
      table,
      modelProp: table.entity.charAt(0).toLowerCase() + table.entity.slice(1),
      emailField: email.field,
      passwordField: password.field,
      nameField: name?.field ?? null,
      roleField: role?.field ?? null,
      softDelete: table.columns.some((c) => c.name === 'deleted_at'),
      extraRequired,
    };
  }
  return null;
}

/** True when this module is the one serving register/login. */
export function isAuthModule(mod: ModuleModel): boolean {
  const paths = mod.endpoints.map((e) => `${e.method} ${e.routePath}`.toLowerCase());
  return paths.includes('post /register') && paths.includes('post /login');
}

/** The handler that serves a given route, so emitted names match the router. */
function handlerFor(mod: ModuleModel, method: string, routePath: string): string | null {
  const match = mod.endpoints.find(
    (e) => e.method.toLowerCase() === method && e.routePath.toLowerCase() === routePath,
  );
  return match?.handlerName ?? null;
}

function registerFields(credential: CredentialModel): string[] {
  const fields = [credential.emailField, 'password'];
  if (credential.nameField) fields.push(credential.nameField);
  for (const column of credential.extraRequired) fields.push(column.field);
  return fields;
}

export function emitAuthService(mod: ModuleModel, credential: CredentialModel): GeneratedFile {
  const { modelProp, emailField, passwordField, nameField, roleField } = credential;
  const nameSelect = nameField ? `${nameField}: true,` : '';
  const roleSelect = roleField ? `${roleField}: true,` : '';
  const deletedFilter = credential.softDelete ? 'deletedAt: null, ' : '';

  const createData = [
    `${emailField}: input.${emailField}.trim().toLowerCase(),`,
    `${passwordField}: await bcrypt.hash(input.password, SALT_ROUNDS),`,
    ...(nameField ? [`${nameField}: input.${nameField}.trim(),`] : []),
    ...credential.extraRequired.map((c) => `${c.field}: input.${c.field},`),
  ].join('\n        ');

  const inputFields = [
    `${emailField}: string;`,
    'password: string;',
    ...(nameField ? [`${nameField}: string;`] : []),
    ...credential.extraRequired.map((c) => `${c.field}: string;`),
  ].join('\n  ');

  return file(
    `src/modules/${mod.name}/services/${mod.name}.service.ts`,
    'typescript',
    `import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

import { config } from '../../../shared/config/index.js';
import { prisma } from '../../../shared/database/prisma.js';
import { ConflictError, UnauthorizedError } from '../../../shared/errors/app-error.js';

/** Cost factor for password hashing. 10 is the usual balance of the two risks. */
const SALT_ROUNDS = 10;
/** Access tokens are short-lived; seconds rather than a duration string so
 *  the value means the same thing to every version of the JWT typings. */
const TOKEN_TTL_SECONDS = 60 * 60;

export interface RegisterInput {
  ${inputFields}
}

export interface LoginInput {
  ${emailField}: string;
  password: string;
}

/** What the API returns about a signed-in user. Never the password hash. */
export interface PublicUser {
  id: string;
  ${emailField}: string;
  name: string;
  roles: string[];
}

export interface AuthResult {
  accessToken: string;
  user: PublicUser;
}

interface StoredUser {
  id: string;
  ${emailField}: string;
  ${passwordField}: string;
${nameField ? `  ${nameField}: string;\n` : ''}${roleField ? `  ${roleField}: string;\n` : ''}}

function publicUser(user: Omit<StoredUser, '${passwordField}'>): PublicUser {
  return {
    id: user.id,
    ${emailField}: user.${emailField},
    name: ${nameField ? `user.${nameField}` : `user.${emailField}`},
    roles: ${roleField ? `[String(user.${roleField})]` : '[]'},
  };
}

function issueToken(user: PublicUser): string {
  return jwt.sign(
    { sub: user.id, email: user.${emailField}, roles: user.roles },
    config.auth.jwtSecret,
    { expiresIn: TOKEN_TTL_SECONDS },
  );
}

const PUBLIC_SELECT = {
  id: true,
  ${emailField}: true,
  ${nameSelect}
  ${roleSelect}
} as const;

export class ${mod.className}Service {
  /**
   * Creates an account. The uniqueness check is a friendly pre-check, not
   * the guarantee — the unique index on ${emailField} is, which is why a
   * duplicate that slips between the check and the insert is caught too.
   */
  async register(input: RegisterInput): Promise<AuthResult> {
    const email = input.${emailField}.trim().toLowerCase();
    const existing = await prisma.${modelProp}.findFirst({ where: { ${emailField}: email } });
    if (existing) throw new ConflictError('That ${emailField} is already registered');

    try {
      const created = await prisma.${modelProp}.create({
        data: {
        ${createData}
        },
        select: PUBLIC_SELECT,
      });
      const user = publicUser(created as Omit<StoredUser, '${passwordField}'>);
      return { accessToken: issueToken(user), user };
    } catch (error) {
      if (error instanceof Error && error.message.includes('Unique constraint')) {
        throw new ConflictError('That ${emailField} is already registered');
      }
      throw error;
    }
  }

  /**
   * Verifies a credential. A missing user and a wrong password fail the
   * same way on purpose: telling them apart tells an attacker which
   * addresses have accounts.
   */
  async login(input: LoginInput): Promise<AuthResult> {
    const email = input.${emailField}.trim().toLowerCase();
    const found = await prisma.${modelProp}.findFirst({ where: { ${deletedFilter}${emailField}: email } });
    const stored = found as StoredUser | null;
    if (!stored) throw new UnauthorizedError('Incorrect ${emailField} or password');

    const matches = await bcrypt.compare(input.password, stored.${passwordField});
    if (!matches) throw new UnauthorizedError('Incorrect ${emailField} or password');

    const user = publicUser(stored);
    return { accessToken: issueToken(user), user };
  }

  /** The signed-in user, read fresh — a token says who, the row says what. */
  async me(userId: string): Promise<PublicUser> {
    const found = await prisma.${modelProp}.findFirst({
      where: { ${deletedFilter}id: userId },
      select: PUBLIC_SELECT,
    });
    if (!found) throw new UnauthorizedError('This session no longer matches a user');
    return publicUser(found as Omit<StoredUser, '${passwordField}'>);
  }

  /** A fresh token for a still-valid session. */
  async refresh(userId: string): Promise<AuthResult> {
    const user = await this.me(userId);
    return { accessToken: issueToken(user), user };
  }
}
`,
  );
}

export function emitAuthController(mod: ModuleModel): GeneratedFile {
  const registerHandler = handlerFor(mod, 'post', '/register') ?? 'postRegister';
  const loginHandler = handlerFor(mod, 'post', '/login') ?? 'postLogin';
  const refreshHandler = handlerFor(mod, 'post', '/refresh');
  const logoutHandler = handlerFor(mod, 'post', '/logout');
  const meHandler = handlerFor(mod, 'get', '/me');

  const methods: string[] = [
    `  ${registerHandler} = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const result = await this.service.register(req.body as RegisterInput);
    sendCreated(res, result, 'Account created');
  });`,
    `  ${loginHandler} = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const result = await this.service.login(req.body as LoginInput);
    sendSuccess(res, result, 'Signed in');
  });`,
  ];

  if (refreshHandler) {
    methods.push(`  ${refreshHandler} = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const result = await this.service.refresh(requireUserId(req));
    sendSuccess(res, result, 'Session refreshed');
  });`);
  }

  if (logoutHandler) {
    methods.push(`  ${logoutHandler} = asyncHandler(async (_req: Request, res: Response): Promise<void> => {
    // The session lives in a signed token the client holds, so there is
    // nothing on the server to revoke. Say so plainly rather than pretend.
    sendSuccess(res, { signedOut: true }, 'Signed out — discard the token');
  });`);
  }

  if (meHandler) {
    methods.push(`  ${meHandler} = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const user = await this.service.me(requireUserId(req));
    sendSuccess(res, user);
  });`);
  }

  const needsRequireUserId = Boolean(refreshHandler ?? meHandler);

  return file(
    `src/modules/${mod.name}/controllers/${mod.name}.controller.ts`,
    'typescript',
    `import type { Request, Response } from 'express';

import { asyncHandler } from '../../../shared/http/async-handler.js';
import { sendCreated, sendSuccess } from '../../../shared/http/response.js';
${needsRequireUserId ? `import { UnauthorizedError } from '../../../shared/errors/app-error.js';\n` : ''}import { ${mod.className}Service } from '../services/${mod.name}.service.js';
import type { LoginInput, RegisterInput } from '../services/${mod.name}.service.js';
${
  needsRequireUserId
    ? `
/** The authenticated principal, or a 401 — never an assumed user id. */
function requireUserId(req: Request): string {
  const id = req.user?.id;
  if (!id) throw new UnauthorizedError();
  return id;
}
`
    : ''
}
/** ${mod.className} — register, sign in, and report the current user. */
export class ${mod.className}Controller {
  private readonly service = new ${mod.className}Service();

${methods.join('\n\n')}
}
`,
  );
}

/** Zod bodies for the credential endpoints, matching the register input. */
export function emitAuthValidators(mod: ModuleModel, credential: CredentialModel): GeneratedFile {
  const { emailField } = credential;
  const fields = registerFields(credential)
    .map((field) => {
      if (field === emailField) return `  ${field}: z.string().trim().email().max(320),`;
      if (field === 'password') return `  password: z.string().min(8).max(200),`;
      return `  ${field}: z.string().trim().min(1).max(255),`;
    })
    .join('\n');

  return file(
    `src/modules/${mod.name}/validators/${mod.name}.validators.ts`,
    'typescript',
    `import { z } from 'zod';

/**
 * A password minimum belongs here, at the edge, where a bad one can still
 * be refused — not in the service, which by then has already been asked to
 * hash it.
 */
export const registerSchema = z.object({
${fields}
});

export const loginSchema = z.object({
  ${emailField}: z.string().trim().email().max(320),
  password: z.string().min(1).max(200),
});
`,
  );
}
