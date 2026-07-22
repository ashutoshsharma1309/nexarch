/**
 * Health/readiness/liveness/version route code for the GENERATED backend —
 * mirrors the style of the platform's own `server/src/modules/health`
 * (Kubernetes-style `/health`, `/health/live`, `/health/ready`), which the
 * backend generator itself doesn't emit. Exported as a standalone file the
 * user drops into their project; this module never edits `backend.files`.
 */
import type { HealthBundle } from '../deployment.types.js';

function healthRoutes(): string {
  return `/**
 * Health, readiness, liveness, and version endpoints — mount before auth
 * middleware so orchestrators (Docker, Kubernetes, load balancers) can
 * reach them without credentials.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const startedAt = Date.now();

export const healthRouter: Router = Router();

async function pingDatabase(): Promise<{ status: 'up' | 'down'; error?: string }> {
  try {
    await prisma.$queryRaw\`SELECT 1\`;
    return { status: 'up' };
  } catch (error) {
    return { status: 'down', error: error instanceof Error ? error.message : 'unknown error' };
  }
}

/** Full report — what you'd point a status page or monitoring dashboard at. */
healthRouter.get('/health', async (_req: Request, res: Response) => {
  const database = await pingDatabase();
  const status = database.status === 'up' ? 'ok' : 'degraded';
  res.status(status === 'ok' ? 200 : 503).json({
    status,
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
    checks: { database },
  });
});

/** Liveness — "is the process still running?" No dependency checks. */
healthRouter.get('/health/live', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

/** Readiness — "can this instance take traffic right now?" */
healthRouter.get('/health/ready', async (_req: Request, res: Response) => {
  const database = await pingDatabase();
  res.status(database.status === 'up' ? 200 : 503).json({ status: database.status === 'up' ? 'ready' : 'not-ready' });
});

/** Version — build metadata for "what's actually running in prod right now?" */
healthRouter.get('/version', (_req: Request, res: Response) => {
  res.status(200).json({
    version: process.env.npm_package_version ?? 'unknown',
    commit: process.env.GIT_COMMIT ?? 'unknown',
    builtAt: process.env.BUILD_TIMESTAMP ?? 'unknown',
  });
});
`;
}

export function generateHealthBundle(): HealthBundle {
  return {
    files: [
      {
        path: 'backend/src/shared/health/health.routes.ts',
        language: 'typescript',
        content: healthRoutes(),
      },
    ],
  };
}
