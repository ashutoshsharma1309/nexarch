/**
 * Process entrypoint: boot, listen, and shut down cleanly.
 *
 * Order: config validates on import (fail fast) → database connects →
 * HTTP socket opens. Shutdown reverses it: stop accepting connections,
 * drain, close the database pool, exit. SIGTERM handling matters because
 * every container orchestrator speaks it.
 */
import http from 'node:http';

import { createApp } from './app.js';
import { config } from './shared/config/index.js';
import { connectDatabase, disconnectDatabase } from './shared/database/prisma.js';
import { logger } from './shared/logger/index.js';

const SHUTDOWN_GRACE_MS = 10_000;

async function bootstrap(): Promise<void> {
  try {
    await connectDatabase();
  } catch (error) {
    if (config.isProduction) {
      logger.error('database unreachable at boot — refusing to start', { error });
      process.exit(1);
    }
    // In development the API stays up so the client and health endpoints
    // keep working while MySQL is still starting; /health reports degraded.
    logger.warn('database unreachable — continuing in degraded mode', {
      hint: 'start MySQL with: npm run docker:dev',
    });
  }

  const app = createApp();
  const server = http.createServer(app);

  server.listen(config.server.port, () => {
    logger.info(`NexArch API listening on port ${config.server.port}`, {
      environment: config.env,
      apiPrefix: config.server.apiPrefix,
    });
  });

  let shuttingDown = false;

  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`${signal} received — shutting down`);

    const forceExit = setTimeout(() => {
      logger.error('shutdown grace period exceeded — forcing exit');
      process.exit(1);
    }, SHUTDOWN_GRACE_MS);
    forceExit.unref();

    server.close(() => {
      void disconnectDatabase()
        .catch((error: unknown) => {
          logger.error('failed to close database connection', { error });
        })
        .finally(() => {
          logger.info('shutdown complete');
          process.exit(0);
        });
    });
  };

  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });

  process.on('unhandledRejection', (reason: unknown) => {
    logger.error('unhandled promise rejection', { reason });
    throw reason instanceof Error ? reason : new Error(String(reason));
  });

  process.on('uncaughtException', (error: Error) => {
    // State is unknowable after an uncaught exception; log and die so the
    // orchestrator restarts a clean process.
    logger.error('uncaught exception — terminating', { error });
    process.exit(1);
  });
}

void bootstrap();
