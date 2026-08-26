/**
 * Fills in the Authentication module Phase 5 already scaffolded
 * (`src/modules/authentication/**`, every handler a `NotImplementedError`
 * stub) with a real implementation — register/login/refresh/logout/me
 * wired against whichever table `security-model.ts` detected as the
 * identity table. Any other planned auth endpoint (forgot-password, OTP,
 * …) this module doesn't know how to implement keeps its stub rather than
 * disappearing, so no route Phase 5 already wired is ever dropped.
 *
 * Only runs when an identity table was actually detected — without one
 * there is nothing to query, and the Security Engine does not invent a
 * schema (that would violate "do not modify the database design").
 */
import type { ArchitecturePlan } from '../../../shared/types/architecture.js';
import type { DatabaseDesign, TableDesign } from '../../../shared/types/design.js';
import { camelCase } from '../../../shared/utils/strings.js';
import type { GeneratedFile, IdentityTableInfo } from '../security-engine.types.js';
import { file } from './file-tree.js';
import type { SecurityModel } from './security-model.js';
import { tsType, zodField } from './type-map.js';

const SERVER_MANAGED = new Set(['id', 'created_at', 'updated_at', 'deleted_at']);
const KNOWN_HANDLERS = new Set(['register', 'login', 'refresh', 'logout', 'me']);

function lastSegment(path: string): string {
  return path.replace(/\/$/, '').split('/').pop() ?? '';
}

/** Non-managed, non-identity, non-role columns — the extra fields a real registration form collects. */
function extraColumns(table: TableDesign, identity: IdentityTableInfo) {
  return table.columns.filter(
    (c) =>
      !SERVER_MANAGED.has(c.name) &&
      c.field !== identity.emailField &&
      c.field !== identity.passwordField &&
      c.field !== identity.roleField &&
      !/role/i.test(c.field),
  );
}

function dtoFile(table: TableDesign, identity: IdentityTableInfo): GeneratedFile {
  const extras = extraColumns(table, identity);
  const recordFields = table.columns.map((c) => `  ${c.field}: ${tsType(c)};`).join('\n');
  const extraFields = extras
    .map((c) => {
      const hasDefault = Boolean(c.defaultExpression) || c.enumValues !== undefined;
      const optional = c.nullable || hasDefault ? '?' : '';
      return `  ${c.field}${optional}: ${tsType(c)};`;
    })
    .join('\n');

  return file(
    'src/modules/authentication/dto/authentication.dto.ts',
    'typescript',
    `/** ${identity.entity} entity, mirroring the Prisma model — the identity table the Security Engine detected. */
export interface ${identity.entity}Record {
${recordFields}
}

export interface RegisterInput {
  email: string;
  password: string;
${extraFields ? `${extraFields}\n` : ''}}

export interface LoginInput {
  email: string;
  password: string;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  roles: string[];
}

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}
`,
  );
}

function validatorsFile(table: TableDesign, identity: IdentityTableInfo): GeneratedFile {
  const extras = extraColumns(table, identity);
  const extraLines = extras.map((c) => `  ${c.field}: ${zodField(c, false)},`).join('\n');

  return file(
    'src/modules/authentication/validators/authentication.validators.ts',
    'typescript',
    `import { z } from 'zod';

/**
 * Password strength is checked separately in the service via the generated
 * password policy (\`validatePassword\`) so violations surface as a field-by-
 * field message list rather than one generic Zod error.
 */
export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
${extraLines}
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
`,
  );
}

function repositoryFile(identity: IdentityTableInfo): GeneratedFile {
  const modelProp = camelCase(identity.entity);
  return file(
    'src/modules/authentication/repositories/authentication.repository.ts',
    'typescript',
    `import { BaseRepository } from '../../../shared/database/base.repository.js';
import type { ${identity.entity}Record } from '../dto/authentication.dto.js';

/** Data access for ${identity.entity}, the table the Security Engine detected as the identity table. */
export class AuthenticationRepository extends BaseRepository<${identity.entity}Record> {
  constructor() {
    super('${modelProp}');
  }

  async findByEmail(email: string): Promise<${identity.entity}Record | null> {
    return this.model.findFirst({ where: { deletedAt: null, ${identity.emailField}: email } });
  }
}
`,
  );
}

function serviceFile(
  table: TableDesign,
  identity: IdentityTableInfo,
  defaultRole: string,
): GeneratedFile {
  const extras = extraColumns(table, identity);
  const extraAssign = extras.map((c) => `      ${c.field}: input.${c.field},`).join('\n');
  const roleAssign = identity.roleField ? `\n      ${identity.roleField}: DEFAULT_ROLE,` : '';
  const rolesOfBody = identity.roleField
    ? `return [String((record as unknown as Record<string, unknown>).${identity.roleField})];`
    : `return [DEFAULT_ROLE];`;

  return file(
    'src/modules/authentication/services/authentication.service.ts',
    'typescript',
    `import { ConflictError, NotFoundError, UnauthorizedError, ValidationError } from '../../../shared/errors/app-error.js';
import { hashPassword, validatePassword, verifyPassword } from '../../../shared/security/password.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../../shared/security/jwt.js';
import type { AuthResult, AuthUser, LoginInput, RegisterInput, ${identity.entity}Record } from '../dto/authentication.dto.js';
import { AuthenticationRepository } from '../repositories/authentication.repository.js';

/**
 * Registration always assigns this server-chosen default role — a client
 * can never pick its own role at signup, which would otherwise be a
 * privilege-escalation path. Provisioning any other role (Admin, …) is a
 * deliberate out-of-band action (seed script, admin console), not
 * something self-service registration grants.
 */
const DEFAULT_ROLE = '${defaultRole}';

export class AuthenticationService {
  private readonly repository = new AuthenticationRepository();

  async register(input: RegisterInput): Promise<AuthResult> {
    const violations = validatePassword(input.password);
    if (violations.length > 0) {
      throw new ValidationError(
        'Password does not meet policy requirements',
        violations.map((message) => ({ field: 'password', message })),
      );
    }

    const existing = await this.repository.findByEmail(input.email);
    if (existing) throw new ConflictError('An account with this email already exists');

    const passwordHash = await hashPassword(input.password);
    const record = await this.repository.create({
      ${identity.emailField}: input.email,
      ${identity.passwordField}: passwordHash,
${extraAssign}${roleAssign}
    });

    return this.issueTokens(record);
  }

  async login(input: LoginInput): Promise<AuthResult> {
    const record = await this.repository.findByEmail(input.email);
    if (!record) throw new UnauthorizedError('Invalid email or password');

    const hash = (record as unknown as Record<string, unknown>).${identity.passwordField};
    const valid = typeof hash === 'string' && (await verifyPassword(input.password, hash));
    if (!valid) throw new UnauthorizedError('Invalid email or password');

    return this.issueTokens(record);
  }

  async refresh(refreshToken: string): Promise<AuthResult> {
    let subject: string;
    try {
      subject = verifyRefreshToken(refreshToken).sub;
    } catch {
      throw new UnauthorizedError('Invalid or expired refresh token');
    }

    const record = await this.repository.findById(subject);
    if (!record) throw new UnauthorizedError('Account no longer exists');

    return this.issueTokens(record);
  }

  async me(userId: string): Promise<AuthUser> {
    const record = await this.repository.findById(userId);
    if (!record) throw new NotFoundError('Account not found');
    return this.toPublicUser(record);
  }

  private issueTokens(record: ${identity.entity}Record): AuthResult {
    const user = this.toPublicUser(record);
    const accessToken = signAccessToken({ sub: user.id, roles: user.roles, email: user.email });
    const refreshToken = signRefreshToken({ sub: user.id });
    return { accessToken, refreshToken, user };
  }

  private rolesOf(record: ${identity.entity}Record): string[] {
    ${rolesOfBody}
  }

  private toPublicUser(record: ${identity.entity}Record): AuthUser {
    const asRecord = record as unknown as Record<string, unknown>;
    const email = String(asRecord.${identity.emailField});
    return {
      id: String(asRecord.id),
      email,
      // The UI always has something to render: a real name column when the
      // schema has one, the email's local part when it doesn't.
      name: ${
        identity.displayNameField
          ? `String(asRecord.${identity.displayNameField} ?? '').trim() || email.split('@')[0] || email`
          : `email.split('@')[0] ?? email`
      },
      roles: this.rolesOf(record),
    };
  }
}
`,
  );
}

interface ClassifiedEndpoint {
  name: string;
  method: string;
  path: string;
  auth: boolean;
}

function controllerFile(
  handled: ClassifiedEndpoint[],
  unhandled: ClassifiedEndpoint[],
): GeneratedFile {
  const has = (name: string): boolean => handled.some((e) => e.name === name);

  const handledMethods = handled
    .map(({ name }) => {
      switch (name) {
        case 'register':
          return `  register = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const result = await this.service.register(req.body as RegisterInput);
    setRefreshTokenCookie(res, result.refreshToken);
    issueCsrfCookie(res);
    sendCreated(res, { accessToken: result.accessToken, user: result.user }, 'Registered');
  });`;
        case 'login':
          return `  login = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const result = await this.service.login(req.body as LoginInput);
    setRefreshTokenCookie(res, result.refreshToken);
    issueCsrfCookie(res);
    sendSuccess(res, { accessToken: result.accessToken, user: result.user }, 'Logged in');
  });`;
        case 'refresh':
          return `  refresh = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const token = readRefreshTokenCookie(req);
    if (!token) throw new UnauthorizedError('No refresh token presented');
    const result = await this.service.refresh(token);
    setRefreshTokenCookie(res, result.refreshToken);
    sendSuccess(res, { accessToken: result.accessToken, user: result.user }, 'Token refreshed');
  });`;
        case 'logout':
          return `  logout = asyncHandler(async (_req: Request, res: Response): Promise<void> => {
    clearRefreshTokenCookie(res);
    sendNoContent(res);
  });`;
        default:
          return `  me = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const user = await this.service.me((req.user as Express.UserPrincipal).id);
    sendSuccess(res, user);
  });`;
      }
    })
    .join('\n\n');

  const unhandledMethods = unhandled
    .map(
      ({
        name,
      }) => `  ${name} = asyncHandler(async (_req: Request, _res: Response): Promise<void> => {
    throw new NotImplementedError('${name} is not implemented yet');
  });`,
    )
    .join('\n\n');

  const methods = [handledMethods, unhandledMethods].filter(Boolean).join('\n\n');

  const responseHelpers = [
    has('register') ? 'sendCreated' : null,
    has('login') || has('refresh') || has('me') ? 'sendSuccess' : null,
    has('logout') ? 'sendNoContent' : null,
  ].filter((n): n is string => n !== null);
  const errors = [
    unhandled.length > 0 ? 'NotImplementedError' : null,
    has('refresh') ? 'UnauthorizedError' : null,
  ].filter((n): n is string => n !== null);
  const cookieHelpers = [
    has('register') || has('login') || has('refresh') ? 'setRefreshTokenCookie' : null,
    has('refresh') ? 'readRefreshTokenCookie' : null,
    has('logout') ? 'clearRefreshTokenCookie' : null,
  ].filter((n): n is string => n !== null);
  const dtoTypes = [
    has('register') ? 'RegisterInput' : null,
    has('login') ? 'LoginInput' : null,
  ].filter((n): n is string => n !== null);

  const imports = [
    `import type { Request, Response } from 'express';`,
    '',
    `import { asyncHandler } from '../../../shared/http/async-handler.js';`,
    responseHelpers.length > 0
      ? `import { ${responseHelpers.join(', ')} } from '../../../shared/http/response.js';`
      : null,
    errors.length > 0
      ? `import { ${errors.join(', ')} } from '../../../shared/errors/app-error.js';`
      : null,
    cookieHelpers.length > 0
      ? `import { ${cookieHelpers.join(', ')} } from '../../../shared/security/cookies.js';`
      : null,
    has('register') || has('login')
      ? `import { issueCsrfCookie } from '../../../shared/security/csrf.js';`
      : null,
    dtoTypes.length > 0
      ? `import type { ${dtoTypes.join(', ')} } from '../dto/authentication.dto.js';`
      : null,
    `import { AuthenticationService } from '../services/authentication.service.js';`,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');

  return file(
    'src/modules/authentication/controllers/authentication.controller.ts',
    'typescript',
    `${imports}

/**
 * Real implementation for the endpoints the Security Engine knows how to
 * wire against the detected identity table. Any other planned auth
 * endpoint keeps its Phase 5 scaffold stub below.
 */
export class AuthenticationController {
  private readonly service = new AuthenticationService();

${methods}
}
`,
  );
}

function routesFile(handled: ClassifiedEndpoint[], unhandled: ClassifiedEndpoint[]): GeneratedFile {
  const has = (name: string): boolean => handled.some((e) => e.name === name);
  const methodOf = (httpMethod: string): string => httpMethod.toLowerCase();

  const handledLines = handled
    .map(({ name, method, path }) => {
      const middleware: string[] = [];
      if (name === 'register') middleware.push('authLimiter', 'validate({ body: registerSchema })');
      else if (name === 'login') middleware.push('authLimiter', 'validate({ body: loginSchema })');
      else if (name === 'refresh') middleware.push('authLimiter', 'csrfProtection');
      else if (name === 'logout') middleware.push('requireAuth', 'csrfProtection');
      else if (name === 'me') middleware.push('requireAuth');
      const args = [...middleware, `controller.${name}`].join(', ');
      return `authenticationRouter.${methodOf(method)}('${path}', ${args});`;
    })
    .join('\n');

  const unhandledLines = unhandled
    .map(({ name, method, path, auth }) => {
      const args = [auth ? 'requireAuth' : null, `controller.${name}`]
        .filter((a): a is string => a !== null)
        .join(', ');
      return `authenticationRouter.${methodOf(method)}('${path}', ${args});`;
    })
    .join('\n');

  const routeLines = [handledLines, unhandledLines].filter(Boolean).join('\n');

  const needsRequireAuth = has('logout') || has('me') || unhandled.some((e) => e.auth);
  const needsValidate = has('register') || has('login');
  const needsAuthLimiter = has('register') || has('login') || has('refresh');
  const needsCsrf = has('refresh') || has('logout');
  const schemaNames = [
    has('register') ? 'registerSchema' : null,
    has('login') ? 'loginSchema' : null,
  ].filter((n): n is string => n !== null);

  const imports = [
    `import { Router } from 'express';`,
    '',
    needsRequireAuth ? `import { requireAuth } from '../../../shared/middleware/auth.js';` : null,
    needsValidate ? `import { validate } from '../../../shared/middleware/validate.js';` : null,
    needsAuthLimiter
      ? `import { authLimiter } from '../../../shared/security/rate-limiters.js';`
      : null,
    needsCsrf ? `import { csrfProtection } from '../../../shared/security/csrf.js';` : null,
    schemaNames.length > 0
      ? `import { ${schemaNames.join(', ')} } from '../validators/authentication.validators.js';`
      : null,
    `import { AuthenticationController } from '../controllers/authentication.controller.js';`,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');

  return file(
    'src/modules/authentication/routes/authentication.routes.ts',
    'typescript',
    `${imports}

export const authenticationRouter: Router = Router();

const controller = new AuthenticationController();

${routeLines}
`,
  );
}

export interface AuthenticationModuleResult {
  files: GeneratedFile[];
  implemented: string[];
  skipped: string[];
}

export function emitAuthenticationModule(
  architecture: ArchitecturePlan,
  database: DatabaseDesign,
  model: SecurityModel,
): AuthenticationModuleResult {
  const identity = model.identity;
  const authModule = architecture.apiModules.find((m) => m.module === 'Authentication');
  if (!identity || !authModule) return { files: [], implemented: [], skipped: [] };

  const table = database.tables.find((t) => t.entity === identity.entity);
  if (!table) return { files: [], implemented: [], skipped: [] };

  const classified: ClassifiedEndpoint[] = authModule.endpoints.map((endpoint) => {
    const relative = endpoint.path.startsWith(authModule.basePath)
      ? endpoint.path.slice(authModule.basePath.length) || '/'
      : endpoint.path;
    return {
      name: lastSegment(endpoint.path),
      method: endpoint.method,
      path: relative,
      auth: endpoint.auth,
    };
  });
  const handled = classified.filter((e) => KNOWN_HANDLERS.has(e.name));
  const unhandled = classified.filter((e) => !KNOWN_HANDLERS.has(e.name));

  if (handled.length === 0) return { files: [], implemented: [], skipped: [] };

  const defaultRole =
    identity.roleValues?.find((r) => r === 'User') ??
    identity.roleValues?.[0] ??
    model.roles.find((r) => r !== 'Admin') ??
    model.roles[0] ??
    'User';

  const files: GeneratedFile[] = [
    dtoFile(table, identity),
    validatorsFile(table, identity),
    repositoryFile(identity),
    serviceFile(table, identity, defaultRole),
    controllerFile(handled, unhandled),
    routesFile(handled, unhandled),
  ];

  return {
    files,
    implemented: handled.map((e) => e.name),
    skipped: unhandled.map((e) => e.name),
  };
}
