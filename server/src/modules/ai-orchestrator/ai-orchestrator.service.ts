/**
 * The single entry point for every AI interaction in NexArch:
 * PromptEngine → ContextBuilder → PromptCompressor → ModelRouter →
 * CacheManager → RetryManager(provider call + response validation) →
 * RequestLogger → GenerationHistory. No other module calls a provider
 * directly — this is the only file in the codebase that imports a
 * provider adapter's `call()`.
 */
import { createHash, randomUUID } from 'node:crypto';

import { AppError } from '../../shared/utils/app-error.js';
import { estimateCost } from './lib/cost-estimator.js';
import { CacheManager, globalCache } from './lib/cache-manager.js';
import { buildContext } from './lib/context-builder.js';
import { compressPrompt } from './lib/prompt-compressor.js';
import { countTokens, recordActual } from '../context-engine/lib/token-counter.js';
import { getPromptTemplate, renderPrompt } from './lib/prompt-engine.js';
import { ModelRouter } from './lib/model-router.js';
import { ProviderCallError } from './lib/providers/http-utils.js';
import {
  getGeneration,
  listHistory,
  nextVersion,
  recordGeneration,
  computeCostAnalytics,
} from './lib/generation-history.js';
import { logGenerationResult, logGenerationStart } from './lib/request-logger.js';
import { validateResponse } from './lib/response-validator.js';
import { NonRetryableError, withRetry } from './lib/retry-manager.js';
import {
  FULL_PIPELINE_WORKFLOW,
  getWorkflow,
  listWorkflows,
  runWorkflow,
} from './lib/workflow-engine.js';
import type {
  ContextPackage,
  CostAnalytics,
  GenerateRequest,
  ModelContentPart,
  PromptImage,
  GenerateResponse,
  GenerationRecord,
  ModelProvider,
  PromptTemplate,
  PromptVariables,
  ValidationResult,
  WorkflowDefinition,
  WorkflowRun,
  WorkflowStepInput,
} from './ai-orchestrator.types.js';

const MAX_TOKENS_BY_COMPLEXITY: Record<GenerateRequest['complexity'], number> = {
  'simple-extraction': 2048,
  'small-file-regen': 4096,
  'large-planning': 8192,
  'complex-refactor': 8192,
  // A visual reading, returned as a compact observation object — not prose.
  'vision-analysis': 2048,
};

/** The routing table every call uses, unless a caller supplies its own. */
const defaultRouter = new ModelRouter();

function buildPromptText(request: GenerateRequest): {
  text: string;
  contextPackage: ContextPackage | null;
} {
  const rendered = renderPrompt(request.promptId, request.variables);
  if (rendered.missingVariables.length > 0) {
    throw AppError.badRequest(
      `Prompt "${request.promptId}" is missing required variable(s): ${rendered.missingVariables.join(', ')}`,
    );
  }

  if (!request.context) return { text: rendered.text, contextPackage: null };

  const contextPackage = buildContext(request.context);
  const contextSection = [
    '## Additional context',
    contextPackage.summary,
    ...contextPackage.manifestReferences,
    ...contextPackage.files.map((f) => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``),
  ]
    .filter(Boolean)
    .join('\n\n');

  return { text: `${rendered.text}\n\n${contextSection}`, contextPackage };
}

/**
 * The user message: plain text as before, or text plus image parts.
 *
 * Each image is introduced by its label, because "the reference screenshot"
 * and "the logo to use as an asset" are different instructions to a model
 * looking at two pictures.
 */
function messageContent(text: string, images: readonly PromptImage[]): string | ModelContentPart[] {
  if (images.length === 0) return text;
  return [
    { type: 'text', text },
    ...images.flatMap((image): ModelContentPart[] => [
      { type: 'text', text: `Image: ${image.label}` },
      { type: 'image_url', image_url: { url: image.dataUrl } },
    ]),
  ];
}

/** Images are large; their digest, not their bytes, belongs in a cache key. */
function digestImages(images: readonly PromptImage[]): string {
  const hash = createHash('sha256');
  for (const image of images) hash.update(image.label).update('\0').update(image.dataUrl);
  return hash.digest('hex');
}

/**
 * Refuse an image a provider cannot see.
 *
 * Refusing is the point. Sending the instruction without the picture would
 * produce an answer that reads like the analysis of an image the model never
 * received — the exact failure this platform must not ship. Exported so the
 * rule can be checked against a specific adapter, rather than through the
 * fallback chain that decides which adapter a call ends up at.
 */
export function ensureImagesSupported(provider: ModelProvider, imageCount: number): void {
  if (imageCount === 0 || provider.supportsImages) return;
  throw new NonRetryableError(
    `The configured AI provider (${provider.name}) cannot read images, so this reference cannot be analysed. Configure a vision-capable provider, or send the instruction without an image.`,
  );
}

export async function generate(
  request: GenerateRequest,
  options: { forceRefresh?: boolean; maxOutputTokens?: number } = {},
  /** Overridable so a test can route a call at a provider it chooses. */
  router: ModelRouter = defaultRouter,
): Promise<GenerateResponse> {
  const startedAt = Date.now();
  const { text, contextPackage } = buildPromptText(request);
  const compression = compressPrompt(text);

  const routed = router.route(request.complexity);
  const images = request.images ?? [];
  ensureImagesSupported(routed.provider, images.length);
  logGenerationStart(request.promptId, routed.provider.id, routed.model);

  // Two requests with the same words but different reference images are not
  // the same request; the digest keeps them in separate cache entries.
  const cacheKey = CacheManager.key(
    request.promptId,
    routed.model,
    images.length === 0 ? compression.text : `${compression.text}\u0000${digestImages(images)}`,
  );
  if (!options.forceRefresh) {
    const cached = globalCache.get(cacheKey);
    if (cached) {
      const validation = validateResponse(cached.content, request.schema);
      const record: GenerationRecord = {
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        promptId: request.promptId,
        provider: cached.provider,
        model: cached.model,
        complexity: request.complexity,
        tokens: cached.usage,
        cost: estimateCost(routed.provider, routed.model, cached.usage),
        durationMs: Date.now() - startedAt,
        status: 'cached',
        cacheHit: true,
        retries: 0,
        validation,
        version: nextVersion(),
      };
      recordGeneration(record);
      logGenerationResult(record);
      return { record, content: cached.content, contextPackage, compression };
    }
  }

  try {
    const outcome = await withRetry(async () => {
      const result = await routed.provider.call({
        model: routed.model,
        messages: [{ role: 'user', content: messageContent(compression.text, images) }],
        maxTokens: options.maxOutputTokens ?? MAX_TOKENS_BY_COMPLEXITY[request.complexity],
        // Every prompt in this platform asks for one structured object.
        // Where the provider can enforce that natively, let it — a schema
        // failure the provider prevents is a retry the platform never pays for.
        json: Boolean(request.schema),
      });

      const validation = validateResponse(result.content, request.schema);
      if (!validation.valid) {
        throw new ProviderCallError(
          'malformed-response',
          `Response failed schema validation: ${validation.issues.map((i) => i.message).join('; ')}`,
        );
      }

      return { result, validation };
    });

    globalCache.set(cacheKey, outcome.result.result);

    // What the counter predicted against what the provider charged. Keeps
    // the estimate honest instead of merely plausible.
    const predicted = countTokens(compression.text, routed.model);
    recordActual(predicted.tokens, outcome.result.result.usage.inputTokens, predicted.method);

    const record: GenerationRecord = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      promptId: request.promptId,
      provider: outcome.result.result.provider,
      model: outcome.result.result.model,
      complexity: request.complexity,
      tokens: outcome.result.result.usage,
      cost: estimateCost(routed.provider, routed.model, outcome.result.result.usage),
      durationMs: Date.now() - startedAt,
      status: 'success',
      cacheHit: false,
      retries: outcome.attempts.length,
      validation: outcome.result.validation,
      version: nextVersion(),
    };
    recordGeneration(record);
    logGenerationResult(record);

    return { record, content: outcome.result.result.content, contextPackage, compression };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failedValidation: ValidationResult = {
      valid: false,
      issues: [{ path: '$', message, kind: 'incomplete' }],
    };
    const record: GenerationRecord = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      promptId: request.promptId,
      provider: routed.provider.id,
      model: routed.model,
      complexity: request.complexity,
      tokens: { inputTokens: 0, outputTokens: 0 },
      cost: {
        provider: routed.provider.id,
        model: routed.model,
        // A call that failed billed nothing. This zero is measured, not a
        // stand-in for a price nobody looked up.
        inputCostUsd: 0,
        outputCostUsd: 0,
        totalCostUsd: 0,
        pricing: { known: true, source: 'the call failed before any tokens were billed' },
      },
      durationMs: Date.now() - startedAt,
      status: 'failed',
      cacheHit: false,
      retries: 0,
      validation: failedValidation,
      version: nextVersion(),
      error: message,
    };
    recordGeneration(record);
    logGenerationResult(record);
    throw AppError.internal(
      `AI generation failed for prompt "${request.promptId}": ${message}`,
      error,
    );
  }
}

export async function retry(request: GenerateRequest): Promise<GenerateResponse> {
  return generate(request, { forceRefresh: true });
}

export async function executeWorkflow(
  workflowId: string,
  steps: WorkflowStepInput[],
): Promise<WorkflowRun> {
  const workflow = getWorkflow(workflowId);
  return runWorkflow(workflow, steps, generate);
}

export function getHistory(limit?: number): GenerationRecord[] {
  return listHistory(limit);
}

export function getGenerationById(id: string): GenerationRecord | null {
  return getGeneration(id);
}

export function getStatistics(): CostAnalytics {
  return computeCostAnalytics(globalCache.stats());
}

export function getWorkflows(): WorkflowDefinition[] {
  return listWorkflows();
}

export function getPromptTemplateMeta(id: string): PromptTemplate {
  return getPromptTemplate(id);
}

export { FULL_PIPELINE_WORKFLOW, NonRetryableError };

/* ── Context-aware generation ─────────────────────────────────────────── */

/**
 * Generate with a compiled context in front of the prompt.
 *
 * This is the Context Engine's entry point into the existing orchestrator,
 * and it deliberately adds nothing else: routing, caching, retries,
 * validation, cost accounting and history are the same code path every
 * other call takes. The only difference is *what* gets sent, which is the
 * whole point — the engine decides relevance before the model is asked, so
 * the model never receives the project and decides for itself.
 *
 * `maxTokens` comes from the context's own budget, which separates the
 * input ceiling from the output ceiling. Conflating them is how a system
 * ends up truncating its own answers as its inputs grow.
 */
export async function generateWithContext(
  context: { text: string; budget: { maxOutputTokens: number } },
  request: Omit<GenerateRequest, 'variables'> & { variables?: PromptVariables },
): Promise<GenerateResponse> {
  return generate(
    {
      ...request,
      variables: {
        ...(request.variables ?? {}),
        // Every prompt template that opts in renders this one placeholder.
        PROJECT_CONTEXT: context.text,
      },
    },
    { maxOutputTokens: context.budget.maxOutputTokens },
  );
}
