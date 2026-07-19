/**
 * Health reporting.
 *
 * Split from the router so orchestration tooling (future CLI, tests, admin
 * module) can consume health data without going through HTTP.
 */
import { config } from '../../shared/config/index.js';
import { pingDatabase } from '../../shared/database/prisma.js';

export interface DependencyCheck {
  status: 'up' | 'down';
  latencyMs?: number;
  error?: string;
}

export interface HealthReport {
  status: 'ok' | 'degraded';
  timestamp: string;
  uptimeSeconds: number;
  environment: string;
  version: string;
  checks: {
    database: DependencyCheck;
  };
}

const SERVICE_VERSION = process.env.npm_package_version ?? '0.1.0';

async function checkDatabase(): Promise<DependencyCheck> {
  try {
    const latencyMs = await pingDatabase();
    return { status: 'up', latencyMs };
  } catch (error) {
    return {
      status: 'down',
      error: error instanceof Error ? error.message : 'unknown database failure',
    };
  }
}

export async function getHealthReport(): Promise<HealthReport> {
  const database = await checkDatabase();

  return {
    status: database.status === 'up' ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    environment: config.env,
    version: SERVICE_VERSION,
    checks: { database },
  };
}
