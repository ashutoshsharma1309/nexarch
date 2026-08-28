/**
 * Prisma client lifecycle.
 *
 * One client per process, event-logged through the application logger so
 * query diagnostics land in the same stream as everything else. Modules
 * import `prisma` for data access and never construct their own client —
 * connection pooling only works when there is exactly one pool.
 *
 * When no DATABASE_URL is configured the server runs in in-memory mode: the
 * client is never constructed, and `prisma` is a guard that throws if any
 * code reaches for it. Every store checks `config.database.enabled` before
 * touching it, so that throw only fires if a data path forgot to — a loud
 * bug, not a silent one.
 */
import { PrismaClient } from '@prisma/client';

import { config } from '../config/index.js';
import { logger } from '../logger/index.js';

function makeClient(): PrismaClient {
  const client = new PrismaClient({
    datasources: { db: { url: config.database.url } },
    log: [
      { emit: 'event', level: 'query' },
      { emit: 'event', level: 'warn' },
      { emit: 'event', level: 'error' },
    ],
  });
  client.$on('warn', (event) => {
    logger.warn(`prisma: ${event.message}`);
  });
  client.$on('error', (event) => {
    logger.error(`prisma: ${event.message}`);
  });
  client.$on('query', (event) => {
    // Query logging is development-only: valuable while building, far too
    // noisy (and potentially sensitive) for production streams.
    if (config.isDevelopment) {
      logger.debug('prisma query', { query: event.query, durationMs: event.duration });
    }
  });
  return client;
}

const disabledGuard = new Proxy({} as PrismaClient, {
  get() {
    throw new Error(
      'Database is disabled (no DATABASE_URL). This code path must branch on config.database.enabled.',
    );
  },
});

export const prisma: PrismaClient = config.database.enabled ? makeClient() : disabledGuard;

export async function connectDatabase(): Promise<void> {
  if (!config.database.enabled) {
    logger.info('running without a database — in-memory mode (set DATABASE_URL to persist)');
    return;
  }
  await prisma.$connect();
  logger.info('database connection established');
}

export async function disconnectDatabase(): Promise<void> {
  if (!config.database.enabled) return;
  await prisma.$disconnect();
  logger.info('database connection closed');
}

/** Round-trip check used by the readiness probe. Returns latency in ms. */
export async function pingDatabase(): Promise<number> {
  if (!config.database.enabled) return 0;
  const startedAt = performance.now();
  await prisma.$queryRaw`SELECT 1`;
  return Math.round(performance.now() - startedAt);
}
