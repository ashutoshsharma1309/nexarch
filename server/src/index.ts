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
import { safeListenHost } from './modules/auth/lib/auth-mode.js';
import { closeExecutionStreams } from './modules/execution-events/execution-events.controller.js';
import { interruptOrphanedJobs } from './modules/execution-events/execution-events.service.js';
import { pruneExecutionHistory } from './modules/execution-events/lib/event-store.js';
import {
  pruneRunWorkspaces,
  reapOrphanedRunnerProcesses,
} from './modules/runner/lib/orphan-reaper.js';
import { reconcileInterruptedRuns } from './modules/pipeline/lib/run-store.js';
import {
  pruneTerminalEditJobs,
  reconcileInterruptedJobs,
} from './modules/project-editor/lib/edit-job-store.js';

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
    // Edits outlive their request, so a restart can land in the middle of
    // one. Saying "interrupted" is the only honest answer: nothing here can
    // know how far it got. Note that it is NOT safe to add "and the project
    // is unchanged" to that message — an apply persists its run before the
    // job row is settled, so an edit killed late may well have landed.
    //
    // Both sweeps above assume this is the only instance running. A second
    // instance booting beside a live one would settle the live one's
    // in-flight work; see docs/SECURITY.md.
    const interruptedEdits = await reconcileInterruptedJobs();
    if (interruptedEdits > 0) {
      logger.warn('edits interrupted by the last shutdown were marked interrupted', {
        count: interruptedEdits,
      });
    }

    // Agent runs live in memory, so their event streams would otherwise never
    // learn that this restart ended them.
    const orphaned = await interruptOrphanedJobs();
    if (orphaned > 0) {
      logger.warn('agent runs interrupted by the last shutdown were closed', { count: orphaned });
    }

    // Maintenance, not recovery: finished edit jobs past the retention
    // window are deleted here because boot is the one moment with no edit of
    // this instance's own in flight. Bounded to one batch, so a long backlog
    // drains over several boots rather than delaying this one; a failure is
    // logged and ignored, because housekeeping must never stop a start-up.
    const prunedEdits = await pruneTerminalEditJobs();
    if (prunedEdits.removed > 0 || prunedEdits.error !== null) {
      logger.info('finished edit jobs pruned at boot', {
        removed: prunedEdits.removed,
        more: prunedEdits.more,
        error: prunedEdits.error,
      });
    }
    await pruneExecutionHistory();
  } catch (error) {
    if (config.isProduction) {
      logger.error('database unreachable at boot — refusing to start', { error });
      process.exit(1);
    }
    // In development the API stays up so the client and health endpoints
    // keep working while Postgres is still starting; /health reports degraded.
    // The platform's own database is PostgreSQL — the datasource, the
    // migration lock and the DATABASE_URL check all say so. The hint used to
    // name MySQL, which is the database *generated apps* get, and sent
    // anyone hitting this line to start the wrong service.
    logger.warn('database unreachable — continuing in degraded mode', {
      hint: 'start PostgreSQL and check DATABASE_URL, then restart',
    });
  }

  const app = createApp();
  const server = http.createServer(app);

  // Without login there is no identity to check, so the socket itself is the
  // boundary: bound to loopback only. requireAuth rejects remote peers too,
  // but routes that do not use it would otherwise stay reachable.
  const listenHost = safeListenHost(config.auth.disabled);
  server.listen(config.server.port, listenHost, () => {
    logger.info(`NexArch API listening on port ${config.server.port}`, {
      environment: config.env,
      apiPrefix: config.server.apiPrefix,
      host: listenHost ?? 'all interfaces',
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

    closeExecutionStreams();
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
