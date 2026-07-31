/**
 * The deployment state machine and its in-memory execution store (same
 * "most recent in this process" continuity model the AI Orchestrator's
 * generation history uses). An execution moves strictly forward —
 * queued → building → deploying → monitoring → live | failed — with every
 * transition timestamped, so the client renders real progress instead of a
 * spinner. Provider work runs detached from the request: POST /execute
 * answers 202 with the queued record and the adapter drives transitions
 * through the event sink; a crash in the adapter marks the execution
 * failed and never the process.
 */
import { randomUUID } from 'node:crypto';

import { logger } from '../../../shared/logger/index.js';
import { AppError } from '../../../shared/utils/app-error.js';
import { getProvider } from './providers/provider-registry.js';
import type {
  DeployExecution,
  DeployExecutionPhase,
  DeployExecutionPlan,
  ExecuteDeployRequest,
} from '../deployment.types.js';

/** Legal forward moves — anything else is a programming error worth failing loudly on. */
const TRANSITIONS: Record<DeployExecutionPhase, DeployExecutionPhase[]> = {
  queued: ['building', 'failed'],
  building: ['deploying', 'failed'],
  deploying: ['monitoring', 'live', 'failed'],
  monitoring: ['deploying', 'live', 'failed'], // providers alternate poll/monitor
  live: [],
  failed: [],
};

const MAX_EXECUTIONS = 50;

const executions = new Map<string, DeployExecution>();

function transition(execution: DeployExecution, phase: DeployExecutionPhase, detail: string): void {
  if (execution.phase === phase) {
    // Same-phase updates (poll ticks) refresh detail without a new edge.
    execution.transitions.push({ phase, at: new Date().toISOString(), detail });
    execution.updatedAt = new Date().toISOString();
    return;
  }
  if (!TRANSITIONS[execution.phase].includes(phase)) {
    throw AppError.internal(
      `Illegal deployment transition ${execution.phase} → ${phase} — state machine bug`,
    );
  }
  execution.phase = phase;
  execution.updatedAt = new Date().toISOString();
  execution.transitions.push({ phase, at: execution.updatedAt, detail });
}

export function planExecution(request: ExecuteDeployRequest): DeployExecutionPlan {
  const provider = getProvider(request.provider);
  if (!provider) throw AppError.badRequest(`Unknown deploy provider "${request.provider}"`);

  return {
    provider: provider.id,
    providerName: provider.name,
    configured: provider.isConfigured(),
    requiredEnv: provider.requiredEnv,
    strategy: provider.strategy,
    steps: [
      { name: 'build', description: `Prepare ${String(request.files.length)} project file(s)` },
      { name: 'deploy', description: provider.strategy },
      { name: 'monitor', description: 'Poll the provider until the deployment is live or failed' },
      { name: 'url', description: 'Report the public deployment URL' },
    ],
    artifactSummary: {
      fileCount: request.files.length,
      hasBackend: request.files.some((f) => f.path.startsWith('backend/')),
      hasFrontend: request.files.some((f) => f.path.startsWith('frontend/')),
    },
  };
}

export function startExecution(request: ExecuteDeployRequest): DeployExecution {
  const provider = getProvider(request.provider);
  if (!provider) throw AppError.badRequest(`Unknown deploy provider "${request.provider}"`);
  if (!provider.isConfigured()) {
    throw AppError.forbidden(
      `${provider.name} deploys are disabled — set ${provider.requiredEnv.join(', ')} and restart the server`,
    );
  }

  const now = new Date().toISOString();
  const execution: DeployExecution = {
    id: randomUUID(),
    provider: provider.id,
    projectName: request.projectName,
    phase: 'queued',
    transitions: [{ phase: 'queued', at: now, detail: 'Execution accepted' }],
    url: null,
    error: null,
    createdAt: now,
    updatedAt: now,
  };

  executions.set(execution.id, execution);
  // Bound memory: drop the oldest finished executions past the cap.
  if (executions.size > MAX_EXECUTIONS) {
    for (const [id, record] of executions) {
      if (executions.size <= MAX_EXECUTIONS) break;
      if (record.phase === 'live' || record.phase === 'failed') executions.delete(id);
    }
  }

  // Detached execution — the HTTP response is the queued record, not the outcome.
  void provider
    .deploy(
      { projectName: request.projectName, files: request.files, env: request.env ?? {} },
      {
        transition: (phase, detail) => {
          transition(execution, phase, detail);
        },
      },
    )
    .then((result) => {
      execution.url = result.url;
      transition(execution, 'live', `Live at ${result.url} (vendor id ${result.vendorId})`);
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      execution.error = message;
      // `failed` is reachable from every non-terminal phase, so transition
      // directly; if the adapter already reached a terminal phase this is a
      // state-machine bug and the log line below is the evidence.
      try {
        transition(execution, 'failed', message);
      } catch (transitionError) {
        logger.error('deploy execution failed after reaching a terminal phase', {
          executionId: execution.id,
          error: transitionError,
        });
      }
      logger.warn('deploy execution failed', { executionId: execution.id, error: message });
    });

  return execution;
}

export function getExecution(id: string): DeployExecution {
  const execution = executions.get(id);
  if (!execution) throw AppError.notFound(`No deployment execution with id ${id}`);
  return execution;
}

export function listExecutions(): DeployExecution[] {
  return [...executions.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
