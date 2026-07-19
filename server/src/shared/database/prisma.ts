/**
 * Prisma client lifecycle.
 *
 * One client per process, event-logged through the application logger so
 * query diagnostics land in the same stream as everything else. Modules
 * import `prisma` for data access and never construct their own client —
 * connection pooling only works when there is exactly one pool.
 */
import { PrismaClient } from '@prisma/client';

import { config } from '../config/index.js';
import { logger } from '../logger/index.js';

export const prisma = new PrismaClient({
  datasources: { db: { url: config.database.url } },
  log: [
    { emit: 'event', level: 'query' },
    { emit: 'event', level: 'warn' },
    { emit: 'event', level: 'error' },
  ],
});

prisma.$on('warn', (event) => {
  logger.warn(`prisma: ${event.message}`);
});

prisma.$on('error', (event) => {
  logger.error(`prisma: ${event.message}`);
});

prisma.$on('query', (event) => {
  // Query logging is development-only: valuable while building, far too
  // noisy (and potentially sensitive) for production streams.
  if (config.isDevelopment) {
    logger.debug('prisma query', { query: event.query, durationMs: event.duration });
  }
});

export async function connectDatabase(): Promise<void> {
  await prisma.$connect();
  logger.info('database connection established');
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
  logger.info('database connection closed');
}

/** Round-trip check used by the readiness probe. Returns latency in ms. */
export async function pingDatabase(): Promise<number> {
  const startedAt = performance.now();
  await prisma.$queryRaw`SELECT 1`;
  return Math.round(performance.now() - startedAt);
}
