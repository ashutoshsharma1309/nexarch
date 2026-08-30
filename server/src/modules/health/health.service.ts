/**
 * Health reporting.
 *
 * Split from the router so orchestration tooling (future CLI, tests, admin
 * module) can consume health data without going through HTTP.
 */
import { accessSync, constants as fsConstants, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { config } from '../../shared/config/index.js';
import { pingDatabase } from '../../shared/database/prisma.js';
import { runnableAgents } from '../agent-orchestrator/lib/registry.js';

export interface DependencyCheck {
  status: 'up' | 'down';
  latencyMs?: number;
  error?: string;
  detail?: string;
}

export interface HealthReport {
  status: 'ok' | 'degraded';
  timestamp: string;
  uptimeSeconds: number;
  environment: string;
  version: string;
  checks: {
    database: DependencyCheck;
    aiProvider: DependencyCheck;
    agentRuntime: DependencyCheck;
    storage: DependencyCheck;
  };
}

const SERVICE_VERSION = process.env.npm_package_version ?? '0.1.0';

async function checkDatabase(): Promise<DependencyCheck> {
  // No database configured — in-memory mode is healthy by design.
  if (!config.database.enabled) {
    return { status: 'up', detail: 'in-memory (no database configured)' };
  }
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

/**
 * Is a model provider configured? Reports only presence, never the value —
 * a health check that echoed the key would be the leak it exists to guard
 * against.
 */
function checkAiProvider(): DependencyCheck {
  if (config.isTest) return { status: 'up' };
  const configured = Boolean(process.env.AI_API_KEY) || process.env.AI_PROVIDER === 'mock';
  return configured
    ? { status: 'up' }
    : { status: 'down', error: 'No AI provider is configured (AI_API_KEY missing)' };
}

/** Can the process reach its own temp workspace root? */
function checkStorage(): DependencyCheck {
  try {
    const dir = process.env.NEXARCH_RUNNER_DIR ?? join(tmpdir(), 'nexarch-runs');
    mkdirSync(dir, { recursive: true });
    accessSync(dir, fsConstants.W_OK);
    return { status: 'up' };
  } catch (error) {
    return {
      status: 'down',
      error: error instanceof Error ? error.message : 'storage unavailable',
    };
  }
}

/** The agent runtime is up when its registry has enabled agents to run. */
function checkAgentRuntime(): DependencyCheck {
  const enabled = runnableAgents().length;
  return enabled > 0 ? { status: 'up' } : { status: 'down', error: 'No agents are enabled' };
}

export async function getHealthReport(): Promise<HealthReport> {
  const database = await checkDatabase();
  const aiProvider = checkAiProvider();
  const agentRuntime = checkAgentRuntime();
  const storage = checkStorage();

  // The database is the only hard dependency; a missing provider degrades
  // rather than downs the service, because reads still work without it.
  const status = database.status === 'up' ? 'ok' : 'degraded';

  return {
    status,
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    environment: config.env,
    version: SERVICE_VERSION,
    checks: { database, aiProvider, agentRuntime, storage },
  };
}
