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
import {
  pruneRunWorkspaces,
  reapOrphanedRunnerProcesses,
} from './modules/runner/lib/orphan-reaper.js';
import { reconcileInterruptedRuns } from './modules/pipeline/lib/run-store.js';

const SHUTDOWN_GRACE_MS = 10_000;

async function bootstrap(): Promise<void> {
  // Before anything can allocate a port: stop dev servers left behind by a
  // NexArch that was killed rather than shut down. Said out loud, because a
  // silent cleanup hides the fact that the last shutdown was not clean.
  const reaped = reapOrphanedRunnerProcesses();
  if (reaped > 0) {
    logger.warn('reaped generated-app processes left over from a previous run', { count: reaped });
  }

  // Then the disk they were using. Each run workspace carries its own
  // installed node_modules, so leaving every one of them behind fills the
  // disk and the next run's install is what pays for it.
  const pruned = pruneRunWorkspaces();
  if (pruned.removed > 0) {
    logger.info('removed old run workspaces', {
      count: pruned.removed,
      freedMb: Math.round(pruned.bytes / 1_000_000),
    });
  }

  try {
    await connectDatabase();
    // With the database up, settle any run the last process left mid-flight.
    // Until this existed, a restart during a build left the project showing
    // "building" forever, with nothing building.
    const settled = await reconcileInterruptedRuns();
    if (settled.reconciled > 0) {
      logger.warn('runs interrupted by the last shutdown were marked failed', {
        count: settled.reconciled,
      });
    }
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
