/**
 * Emits the generated project's `src/shared/**` layer: the standard response
 * envelope, the error hierarchy and central handler, request context/logging/
 * validation middleware, a scaffolded auth guard (the Security Engine fills
 * it in Phase 6), validated config, the Winston logger, the Prisma client,
 * and a generic base repository decoupled from the generated client types.
 *
 * Generated code is ESM/NodeNext with `.js` import specifiers and strict TS,
 * matching a modern Node 22 + Express 5 backend.
 */
import type { GeneratedFile } from '../backend-generator.types.js';
import { file } from './file-tree.js';

const response = `import type { Response } from 'express';

export interface ResponseMeta {
  [key: string]: unknown;
}

/** The single response envelope for every endpoint. */
export function sendSuccess<T>(
  res: Response,
  data: T,
  message = '',
  meta: ResponseMeta = {},
  status = 200,
): void {
  res.status(status).json({ success: true, message, data, meta });
}

export function sendCreated<T>(res: Response, data: T, message = 'Created'): void {
  sendSuccess(res, data, message, {}, 201);
}

export function sendNoContent(res: Response): void {
  res.status(204).send();
}
`;

const asyncHandler = `import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Wrap an async controller so rejected promises reach the error middleware.
 * (Express 5 forwards them natively; this keeps intent explicit and supports
 * Express 4 tooling.)
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
`;

const appError = `export type ErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_FAILED'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'NOT_IMPLEMENTED'
  | 'INTERNAL_ERROR';

export interface ErrorDetail {
  field: string;
  message: string;
}

/** Base class for every error the API deliberately surfaces to a client. */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly isOperational: boolean;
  readonly details: ErrorDetail[] | undefined;

  constructor(
    statusCode: number,
    code: ErrorCode,
    message: string,
    details?: ErrorDetail[],
    isOperational = true,
  ) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, new.target);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Request validation failed', details?: ErrorDetail[]) {
    super(422, 'VALIDATION_FAILED', message, details);
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad request') {
    super(400, 'BAD_REQUEST', message);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(401, 'UNAUTHORIZED', message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Insufficient permissions') {
    super(403, 'FORBIDDEN', message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(404, 'NOT_FOUND', message);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource already exists') {
    super(409, 'CONFLICT', message);
  }
}

export class NotImplementedError extends AppError {
  constructor(message = 'Not implemented') {
    super(501, 'NOT_IMPLEMENTED', message);
  }
}

export class InternalServerError extends AppError {
  constructor(message = 'Internal server error') {
    super(500, 'INTERNAL_ERROR', message, undefined, false);
  }
}
`;

const errorHandler = `import { Prisma } from '@prisma/client';
import type { ErrorRequestHandler, RequestHandler } from 'express';

import { config } from '../config/index.js';
import { logger } from '../logger/index.js';
import { AppError, InternalServerError, NotFoundError, ConflictError } from '../errors/app-error.js';

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new NotFoundError('Route ' + req.method + ' ' + req.path + ' does not exist'));
};

function normalize(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') return new ConflictError('A record with this value already exists');
    if (error.code === 'P2025') return new NotFoundError('The requested record does not exist');
  }
  return new InternalServerError();
}

/** The only place errors become HTTP responses. */
export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  const appError = normalize(error);
  const context = {
    requestId: req.id,
    method: req.method,
    path: req.originalUrl,
    statusCode: appError.statusCode,
    code: appError.code,
  };

  if (appError.isOperational) logger.warn(appError.message, context);
  else logger.error(appError.message, { ...context, error });

  res.status(appError.statusCode).json({
    success: false,
    message:
      appError.isOperational || !config.isProduction ? appError.message : 'Internal server error',
    data: null,
    meta: { requestId: req.id },
    error: { code: appError.code, details: appError.details ?? [] },
  });
};
`;

const requestContext = `import { randomUUID } from 'node:crypto';

import type { RequestHandler } from 'express';

export const requestContext: RequestHandler = (req, res, next) => {
  const incoming = req.get('X-Request-Id');
  req.id = incoming && /^[\\w.-]{1,128}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
};
`;

const requestLogger = `import morgan from 'morgan';
import type { RequestHandler } from 'express';

import { config } from '../config/index.js';
import { httpLogStream } from '../logger/index.js';

morgan.token('id', (req) => (req as { id?: string }).id ?? '-');

const format = config.isProduction
  ? ':id :method :url :status :response-time ms'
  : ':method :url :status :response-time ms';

export const requestLogger: RequestHandler = morgan(format, { stream: httpLogStream });
`;

const validate = `import type { RequestHandler } from 'express';
import type { ZodTypeAny } from 'zod';

import { ValidationError } from '../errors/app-error.js';

interface Schemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

/** Validate the request against Zod schemas; forwards a 422 with field details. */
export function validate(schemas: Schemas): RequestHandler {
  return (req, _res, next) => {
    for (const key of ['body', 'query', 'params'] as const) {
      const schema = schemas[key];
      if (!schema) continue;
      const result = schema.safeParse(req[key]);
      if (!result.success) {
        const details = result.error.issues.map((issue) => ({
          field: issue.path.join('.') || key,
          message: issue.message,
        }));
        next(new ValidationError('Request validation failed', details));
        return;
      }
      // Assign parsed/coerced values back (params/query are writable in Express 5).
      Object.assign(req[key] as Record<string, unknown>, result.data as Record<string, unknown>);
    }
    next();
  };
}
`;

const authGuard = `import type { RequestHandler } from 'express';

import { ForbiddenError, UnauthorizedError } from '../errors/app-error.js';

/**
 * Authentication scaffold.
 *
 * Phase 6 (the Security Engine) implements real JWT verification here. For
 * now this guard enforces the *shape* of protected routes: it requires a
 * bearer token to be present and attaches a placeholder principal, so the
 * request pipeline is complete and every protected route is wired — without
 * this phase generating any security logic.
 */
export const requireAuth: RequestHandler = (req, _res, next) => {
  const header = req.get('Authorization');
  if (!header || !header.startsWith('Bearer ')) {
    next(new UnauthorizedError());
    return;
  }
  // TODO(Phase 6 — Security Engine): verify the JWT and load the real user.
  req.user = { id: 'stub-user', roles: [] };
  next();
};

/** Restrict a route to specific roles. Enforced once Phase 6 populates roles. */
export function requireRoles(...roles: string[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) {
      next(new UnauthorizedError());
      return;
    }
    if (roles.length > 0 && !roles.some((role) => req.user?.roles.includes(role))) {
      next(new ForbiddenError());
      return;
    }
    next();
  };
}
`;

const envConfig = `import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'debug']).default('info'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  CORS_ORIGINS: z.string().default('*'),
  // Consumed by the Security Engine (Phase 6); validated now so deploys fail early.
  JWT_SECRET: z.string().min(16).default('change-me-in-production-please'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => '  - ' + i.path.join('.') + ': ' + i.message).join('\\n');
  process.stderr.write('Invalid environment configuration\\n' + issues + '\\n');
  process.exit(1);
}

export const env = parsed.data;
`;

const configIndex = `import { env } from './env.js';

export const config = {
  env: env.NODE_ENV,
  isProduction: env.NODE_ENV === 'production',
  isDevelopment: env.NODE_ENV === 'development',
  server: { port: env.PORT, apiPrefix: '/api/v1', bodyLimit: '1mb' },
  database: { url: env.DATABASE_URL },
  cors: { origins: env.CORS_ORIGINS.split(',').map((o) => o.trim()) },
  auth: { jwtSecret: env.JWT_SECRET },
  logging: { level: env.LOG_LEVEL },
} as const;
`;

const logger = `import winston from 'winston';

import { config } from '../config/index.js';

const devFormat = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
  winston.format.colorize({ level: true }),
  winston.format.printf((info) => info.timestamp + ' ' + info.level + ' ' + String(info.message)),
);

export const logger = winston.createLogger({
  level: config.logging.level,
  format: config.isProduction
    ? winston.format.combine(winston.format.timestamp(), winston.format.json())
    : devFormat,
  transports: [new winston.transports.Console()],
});

export const httpLogStream = {
  write(message: string): void {
    logger.http(message.trim());
  },
};
`;

const prismaClient = `import { PrismaClient, Prisma } from '@prisma/client';

import { config } from '../config/index.js';
import { logger } from '../logger/index.js';

export const prisma = new PrismaClient({
  datasources: { db: { url: config.database.url } },
  log: [{ emit: 'event', level: 'warn' }, { emit: 'event', level: 'error' }],
});

prisma.$on('warn', (event) => logger.warn('prisma: ' + event.message));
prisma.$on('error', (event) => logger.error('prisma: ' + event.message));

export async function connectDatabase(): Promise<void> {
  await prisma.$connect();
  logger.info('database connection established');
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
  logger.info('database connection closed');
}

/** Run work inside a database transaction. */
export function transaction<R>(fn: (tx: Prisma.TransactionClient) => Promise<R>): Promise<R> {
  return prisma.$transaction(fn);
}
`;

const paginationTypes = `export interface PaginationParams {
  page: number;
  limit: number;
  skip: number;
  take: number;
}

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export type SortOrder = 'asc' | 'desc';
`;

const paginationUtil = `import type { PageMeta, PaginationParams, SortOrder } from '../types/pagination.js';

interface ListQuery {
  page?: number;
  limit?: number;
  sort?: string;
  order?: SortOrder;
  search?: string;
}

const MAX_LIMIT = 100;

export function parsePagination(query: ListQuery): PaginationParams {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(query.limit) || 20));
  return { page, limit, skip: (page - 1) * limit, take: limit };
}

export function buildOrderBy(
  query: ListQuery,
  sortable: readonly string[],
  fallback = 'createdAt',
): Record<string, SortOrder> {
  const field = query.sort && sortable.includes(query.sort) ? query.sort : fallback;
  const order: SortOrder = query.order === 'asc' ? 'asc' : 'desc';
  return { [field]: order };
}

export function buildSearchWhere(
  query: ListQuery,
  searchable: readonly string[],
): Record<string, unknown> {
  if (!query.search || searchable.length === 0) return {};
  return {
    OR: searchable.map((field) => ({ [field]: { contains: query.search } })),
  };
}

export function pageMeta(total: number, page: number, limit: number): PageMeta {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return { page, limit, total, totalPages, hasNext: page < totalPages, hasPrev: page > 1 };
}
`;

const baseRepository = `import type { PrismaClient } from '@prisma/client';

import { prisma } from './prisma.js';
import type { SortOrder } from '../types/pagination.js';

/**
 * The subset of a Prisma model delegate the repositories use. Typed
 * generically so every repository compiles against the generated client
 * without importing model-specific types.
 */
export interface ModelDelegate<T> {
  findMany(args?: unknown): Promise<T[]>;
  findFirst(args?: unknown): Promise<T | null>;
  create(args: unknown): Promise<T>;
  update(args: unknown): Promise<T>;
  count(args?: unknown): Promise<number>;
}

export interface FindManyArgs {
  where?: Record<string, unknown>;
  skip?: number;
  take?: number;
  orderBy?: Record<string, SortOrder>;
}

/**
 * Generic repository over one Prisma model. Soft-deleted rows (deletedAt set)
 * are excluded from reads by default; deletes set deletedAt rather than
 * removing rows.
 */
export abstract class BaseRepository<T> {
  protected readonly prisma: PrismaClient = prisma;

  protected constructor(private readonly modelName: string) {}

  protected get model(): ModelDelegate<T> {
    const client = this.prisma as unknown as Record<string, ModelDelegate<T>>;
    const delegate = client[this.modelName];
    if (!delegate) throw new Error('Prisma model "' + this.modelName + '" not found on client');
    return delegate;
  }

  async findMany(args: FindManyArgs): Promise<T[]> {
    return this.model.findMany({ ...args, where: { deletedAt: null, ...(args.where ?? {}) } });
  }

  async count(where: Record<string, unknown> = {}): Promise<number> {
    return this.model.count({ where: { deletedAt: null, ...where } });
  }

  async findById(id: string): Promise<T | null> {
    return this.model.findFirst({ where: { id, deletedAt: null } });
  }

  async create(data: Record<string, unknown>): Promise<T> {
    return this.model.create({ data });
  }

  async update(id: string, data: Record<string, unknown>): Promise<T> {
    return this.model.update({ where: { id }, data });
  }

  async softDelete(id: string): Promise<T> {
    return this.model.update({ where: { id }, data: { deletedAt: new Date() } });
  }
}
`;

const expressTypes = `import 'express';

declare global {
  namespace Express {
    interface UserPrincipal {
      id: string;
      roles: string[];
    }
    interface Request {
      id: string;
      user?: UserPrincipal;
    }
  }
}

export {};
`;

export function emitShared(): GeneratedFile[] {
  return [
    file('src/shared/http/response.ts', 'typescript', response),
    file('src/shared/http/async-handler.ts', 'typescript', asyncHandler),
    file('src/shared/errors/app-error.ts', 'typescript', appError),
    file('src/shared/middleware/error-handler.ts', 'typescript', errorHandler),
    file('src/shared/middleware/request-context.ts', 'typescript', requestContext),
    file('src/shared/middleware/request-logger.ts', 'typescript', requestLogger),
    file('src/shared/middleware/validate.ts', 'typescript', validate),
    file('src/shared/middleware/auth.ts', 'typescript', authGuard),
    file('src/shared/config/env.ts', 'typescript', envConfig),
    file('src/shared/config/index.ts', 'typescript', configIndex),
    file('src/shared/logger/index.ts', 'typescript', logger),
    file('src/shared/database/prisma.ts', 'typescript', prismaClient),
    file('src/shared/database/base.repository.ts', 'typescript', baseRepository),
    file('src/shared/types/pagination.ts', 'typescript', paginationTypes),
    file('src/shared/types/express.d.ts', 'typescript', expressTypes),
    file('src/shared/utils/pagination.ts', 'typescript', paginationUtil),
  ];
}
