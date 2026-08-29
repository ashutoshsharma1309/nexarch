/**
 * Test Engineer — plans meaningful tests, then actually runs them.
 *
 * The split Step 27 demands is the architecture of this file. Deriving the
 * plan and executing it are deterministic: cases come from the product
 * spec, the backend manifest and the OpenAPI schemas, and results come
 * from status codes received over HTTP. The model appears in exactly one
 * place — ranking the planned cases by what matters most to a user of this
 * product — and its output can only reorder work, never invent a test and
 * never touch a result. When the model is unavailable the plan runs in its
 * deterministic order and the report says so.
 *
 * Failed tests become findings; blocked tests do not. A blocked test is
 * the absence of information, and a finding that says "could not run"
 * would bury the finding that explains *why* it could not run — which the
 * runtime or integration engineer has already filed.
 */
import { generateWithContext } from '../../ai-orchestrator/ai-orchestrator.service.js';
import { getAgentDefinition } from '../../../shared/contracts/index.js';
import { logger } from '../../../shared/logger/index.js';
import { AgentError } from '../lib/executor.js';
import { deriveTestPlan } from '../lib/test-plan.js';
import { executeTestPlan } from '../lib/test-executor.js';
import { recordTestRun } from '../lib/validation-store.js';
import type {
  Agent,
  AgentExecutionInput,
  AgentFinding,
  AgentResult,
} from '../../../shared/contracts/index.js';
import type { OpenApiDocument } from '../../../shared/types/design.js';
import type { ProductSpec } from '../../../shared/types/product.js';
import type { RequirementSpec } from '../../../shared/types/requirement.js';
import type { RuntimeResult, TestCase } from '../../../shared/types/validation.js';

const definition = getAgentDefinition('test-engineer');
if (!definition) throw new Error('test-engineer is not declared');

interface RuntimeReport extends RuntimeResult {
  baseUrls?: { backend: string | null; frontend: string | null };
}

interface BackendMetadata {
  modules: { name: string; entity: string | null; crud: boolean }[];
  routes: { method: string; path: string; auth: boolean; implemented: boolean }[];
}

/**
 * Applies the model's ranking to the plan, when there is one.
 *
 * Only names that exist in the plan move; anything the model invents is
 * ignored. Cases the model did not mention keep their derived order after
 * the ranked ones.
 */
function applyRanking(cases: TestCase[], raw: unknown): { ordered: TestCase[]; notes: string[] } {
  const parsed = raw as { ranking?: { name?: unknown; reason?: unknown }[] } | null;
  if (!Array.isArray(parsed?.ranking)) return { ordered: cases, notes: [] };

  const byName = new Map(cases.map((testCase) => [testCase.name, testCase]));
  const ordered: TestCase[] = [];
  const notes: string[] = [];

  for (const entry of parsed.ranking) {
    const name = typeof entry.name === 'string' ? entry.name : '';
    const found = byName.get(name);
    if (!found || ordered.includes(found)) continue;
    ordered.push(found);
    if (typeof entry.reason === 'string' && entry.reason.length > 0) {
      notes.push(`${name}: ${entry.reason}`);
    }
  }
  for (const testCase of cases) {
    if (!ordered.includes(testCase)) ordered.push(testCase);
  }
  return { ordered, notes };
}

function findingsFrom(cases: readonly TestCase[]): AgentFinding[] {
  return cases
    .filter((testCase) => testCase.status === 'FAILED')
    .map((testCase) => ({
      type: 'TEST_FAILURE' as const,
      severity: testCase.priority === 'CRITICAL' ? ('HIGH' as const) : ('MEDIUM' as const),
      category: `TEST_${testCase.type}`,
      title: `Test failed: ${testCase.name}`,
      description: `${testCase.expectedResult} It did not: ${testCase.error ?? 'see evidence'}.`,
      evidence: testCase.evidence,
      recommendation: 'The evidence names the request and the status it produced.',
      targetNodeId: null,
      targetFile: null,
      confidence: 1,
      status: 'OPEN' as const,
    }));
}

export const testEngineerAgent: Agent<{ cases: TestCase[] }> = {
  definition,

  async execute(input: AgentExecutionInput): Promise<AgentResult<{ cases: TestCase[] }>> {
    const startedAt = Date.now();

    const requirements = input.inputArtifacts['requirement-spec'] as RequirementSpec | undefined;
    const product = input.inputArtifacts['product-spec'] as ProductSpec | undefined;
    const api = input.inputArtifacts['api-contract'] as OpenApiDocument | undefined;
    const runtime = input.inputArtifacts['runtime-report'] as RuntimeReport | undefined;
    const backendMeta = input.inputArtifacts['backend-metadata'] as BackendMetadata | undefined;

    if (!requirements || !api || !runtime || !backendMeta) {
      throw new AgentError(
        'invalid-input',
        'The test engineer requires the requirement spec, API contract, backend manifest and runtime report',
      );
    }

    const authExpected = requirements.modules.some((mod) =>
      /auth|login|sign|role|permission|access/i.test(mod),
    );

    /* ── Plan: deterministic ───────────────────────────────────────────── */

    const plan = deriveTestPlan({
      projectId: input.projectId,
      runId: input.runId,
      api,
      product,
      modules: backendMeta.modules,
      routes: backendMeta.routes.map((route) => ({ ...route })),
      authExpected,
    });

    /* ── Prioritize: the model's one job, optional ─────────────────────── */

    let cases = plan;
    let planningNotes: string[] = [];
    let usage: AgentResult['usage'] = null;
    let degraded = false;

    try {
      const response = await generateWithContext(
        input.context ?? { text: '', budget: { maxOutputTokens: 1024 } },
        {
          promptId: 'test-planner',
          complexity: 'simple-extraction',
          schema: 'generic-json',
          variables: {
            PROJECT_NAME: requirements.projectName,
            PROJECT_TYPE: requirements.projectType,
            JOURNEYS:
              (product?.journeys ?? [])
                .map((journey) => `- ${journey.name}: ${journey.steps.join(' → ')}`)
                .join('\n') || 'None stated.',
            TESTS: plan.map((testCase) => `- ${testCase.name} (${testCase.priority})`).join('\n'),
          },
        },
      );
      const ranked = applyRanking(plan, JSON.parse(response.content));
      cases = ranked.ordered;
      planningNotes = ranked.notes;
      usage = {
        provider: response.record.provider,
        model: response.record.model,
        inputTokens: response.record.tokens.inputTokens,
        outputTokens: response.record.tokens.outputTokens,
        costUsd: response.record.cost.totalCostUsd,
        contextTokens: input.context?.tokens ?? 0,
      };
    } catch (error) {
      // The plan runs either way; only the ordering rationale is lost.
      logger.warn('test planner ran without its model pass', { error });
      degraded = true;
    }

    /* ── Execute: deterministic, against the live application ──────────── */

    const apiPrefix = backendMeta.routes[0]?.path.match(/^\/api\/v\d+/)?.[0] ?? '/api/v1';
    const execution = await executeTestPlan({
      cases,
      api,
      backendBaseUrl: runtime.baseUrls?.backend ?? null,
      frontendBaseUrl: runtime.baseUrls?.frontend ?? null,
      apiPrefix,
      runId: input.runId,
      runtimeUp: runtime.startupStatus === 'PASS',
    });

    recordTestRun(input.projectId, input.runId, execution.cases, execution.results);

    return {
      agentId: 'test-engineer',
      status: 'succeeded',
      output: { cases: execution.cases },
      artifacts: {
        'test-report': {
          projectId: input.projectId,
          runId: input.runId,
          cases: execution.cases,
          results: execution.results,
          credentials: execution.credentials,
          planningNotes,
          plannerDegraded: degraded,
          generatedAt: new Date().toISOString(),
        },
      },
      findings: findingsFrom(execution.cases),
      error: null,
      failureKind: null,
      durationMs: Date.now() - startedAt,
      usage,
    };
  },
};
