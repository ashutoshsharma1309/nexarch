/**
 * Integration Engineer — do the running parts fit together?
 *
 * Consumes the runtime engineer's live session and asks the questions a
 * contract review cannot: does every declared endpoint answer, does the
 * auth flow work end to end, does the application reach its database, can
 * the frontend reach the backend. Every answer is a status code that was
 * received, which is why this agent — like the runtime engineer — has no
 * model call.
 *
 * When the runtime never started, its checks are BLOCKED rather than
 * failed: an unreachable application proves nothing about integration
 * except that it could not be checked, and the runtime engineer has
 * already reported the real problem.
 */
import { getAgentDefinition } from '../../../shared/contracts/index.js';
import { AgentError } from '../lib/executor.js';
import { validateIntegration } from '../lib/integration-validation.js';
import type { Agent, AgentExecutionInput, AgentResult } from '../../../shared/contracts/index.js';
import type { OpenApiDocument } from '../../../shared/types/design.js';
import type { IntegrationResult, RuntimeResult } from '../../../shared/types/validation.js';

const definition = getAgentDefinition('integration-engineer');
if (!definition) throw new Error('integration-engineer is not declared');

interface RuntimeReport extends RuntimeResult {
  baseUrls?: { backend: string | null; frontend: string | null };
}

interface BackendMetadata {
  routes: { method: string; path: string }[];
}

export const integrationEngineerAgent: Agent<IntegrationResult> = {
  definition,

  async execute(input: AgentExecutionInput): Promise<AgentResult<IntegrationResult>> {
    const startedAt = Date.now();

    const api = input.inputArtifacts['api-contract'] as OpenApiDocument | undefined;
    const runtime = input.inputArtifacts['runtime-report'] as RuntimeReport | undefined;
    const backendMeta = input.inputArtifacts['backend-metadata'] as BackendMetadata | undefined;

    if (!api || !runtime || !backendMeta) {
      throw new AgentError(
        'invalid-input',
        'The integration engineer requires the API contract, the backend manifest and the runtime report',
      );
    }

    // The mounted prefix comes from the generated routes, never assumed.
    const apiPrefix = backendMeta.routes[0]?.path.match(/^\/api\/v\d+/)?.[0] ?? '/api/v1';

    const validation = await validateIntegration({
      projectId: input.projectId,
      runId: input.runId,
      api,
      runtime,
      backendBaseUrl: runtime.baseUrls?.backend ?? null,
      frontendBaseUrl: runtime.baseUrls?.frontend ?? null,
      apiPrefix,
    });

    return {
      agentId: 'integration-engineer',
      status: 'succeeded',
      output: validation.result,
      artifacts: { 'integration-report': validation.result },
      findings: validation.findings,
      error: null,
      failureKind: null,
      durationMs: Date.now() - startedAt,
      usage: null,
    };
  },
};
