/**
 * Health endpoints, following the Kubernetes probe convention:
 *
 *   GET /api/v1/health        — full diagnostic report (200, or 503 when degraded)
 *   GET /api/v1/health/live   — liveness: the process is running
 *   GET /api/v1/health/ready  — readiness: dependencies are reachable
 */
import { Router } from 'express';

import { sendSuccess } from '../../shared/utils/api-response.js';
import { requireAuth } from '../auth/index.js';
import { getHealthReport } from './health.service.js';
import { getSecurityStatus } from './security-status.js';

export const healthRouter: Router = Router();

healthRouter.get('/', async (_req, res) => {
  const report = await getHealthReport();
  sendSuccess(res, report, { status: report.status === 'ok' ? 200 : 503 });
});

healthRouter.get('/live', (_req, res) => {
  sendSuccess(res, { status: 'ok' });
});

// Behind auth (Step 39): the security posture is not an anonymous map of
// the platform's defenses. It carries only presence and posture — no
// secrets, no values.
healthRouter.get('/security', requireAuth, (_req, res) => {
  sendSuccess(res, getSecurityStatus());
});

healthRouter.get('/ready', async (_req, res) => {
  const report = await getHealthReport();
  sendSuccess(
    res,
    { status: report.status, database: report.checks.database.status },
    { status: report.status === 'ok' ? 200 : 503 },
  );
});
