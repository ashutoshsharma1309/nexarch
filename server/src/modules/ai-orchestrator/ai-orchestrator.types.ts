/**
 * Contracts for the AI Orchestrator & Prompt Intelligence Engine (Phase 9).
 *
 * Every AI interaction in NexArch goes through this module — no other
 * module calls a model provider directly. This module generates no
 * application code of its own (no backend CRUD, no frontend pages, no
 * schema); it's the plumbing a generator would sit behind: prompt
 * templates, provider abstraction, context scoping, caching, retries,
 * validation, and history. Nothing here is written to the platform's own
 * source tree.
 */

/* ── Providers ────────────────────────────────────────────────────────── */

export type ProviderId = 'groq' | 'claude' | 'openai' | 'gemini' | 'openrouter' | 'mock';

export type TaskComplexity =
  | 'simple-extraction'
  | 'large-planning'
  | 'small-file-regen'
  | 'complex-refactor'
  /** Reading a reference image. Routed to a model that can actually see one. */
  | 'vision-analysis';

/**
 * A piece of a multimodal message.
 *
 * Text-only calls keep passing a plain string — the shape every provider
 * adapter here was written against. Parts exist for the one case that needs
 * them: sending a reference image alongside the instruction, in the
 * OpenAI-compatible `image_url` form Groq's vision model accepts.
 */
export type ModelContentPart =
  { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ModelContentPart[];
}

export interface ModelCallOptions {
  model: string;
  messages: ModelMessage[];
  maxTokens: number;
  temperature?: number;
  /** Ask the provider to constrain output to a single JSON object, where it supports that. */
  json?: boolean | undefined;
}

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ModelCallResult {
  content: string;
  usage: ModelUsage;
  model: string;
  provider: ProviderId;
  stopReason: string;
}

/** Every provider adapter (Groq, Claude, OpenAI, Gemini, OpenRouter, Mock) implements this — no call site depends on which one it is. */
export interface ModelProvider {
  readonly id: ProviderId;
  readonly name: string;
  readonly defaultModel: string;
  readonly costPerMillionInputTokens: number;
  readonly costPerMillionOutputTokens: number;
  /** True when this provider has everything it needs (e.g. an API key) to actually make a call. */
  isConfigured(): boolean;
  /**
   * Whether this adapter can carry image parts to its API.
   *
   * An adapter that cannot must say so, because the alternative is sending
   * the instruction without the image and reporting an analysis that never
   * looked at it. The caller is expected to refuse rather than degrade.
   */
  readonly supportsImages: boolean;
  call(options: ModelCallOptions): Promise<ModelCallResult>;
}

export interface ModelRouteRule {
  complexity: TaskComplexity;
  provider: ProviderId;
  model: string;
  /** Fallback provider tried when the preferred one is unconfigured or fails all retries. */
  fallbackProvider?: ProviderId;
  fallbackModel?: string;
}

/* ── Prompt templates ─────────────────────────────────────────────────── */

export interface PromptTemplate {
  id: string;
  file: string;
  variables: string[];
  raw: string;
}

export type PromptVariables = Record<string, string>;

/* ── Context building ─────────────────────────────────────────────────── */

export interface ProjectFileRef {
  path: string;
  content: string;
}

export interface ContextInputs {
  requirements: unknown;
  architecture: unknown;
  databaseDesign: unknown;
  dependencyGraph?: unknown;
  projectManifest?: unknown;
  securityReport?: unknown;
  /** Files the impact analysis (or caller) marked as relevant — never the whole project. */
  affectedFiles: ProjectFileRef[];
}

export interface ContextPackage {
  summary: string;
  manifestReferences: string[];
  files: ProjectFileRef[];
  estimatedTokens: number;
  truncated: boolean;
  omittedFiles: string[];
}

/* ── Compression ──────────────────────────────────────────────────────── */

export interface CompressionResult {
  text: string;
  originalTokens: number;
  compressedTokens: number;
  savingsPercent: number;
}

/* ── Token & cost estimation ─────────────────────────────────────────── */

export interface TokenEstimate {
  inputTokens: number;
  estimatedOutputTokens: number;
  totalTokens: number;
}

/** Whether a price for this model is published, or why it is not. */
export type CostPricing = { known: true; source: string } | { known: false; reason: string };

/**
 * What a call cost, or an honest refusal to say.
 *
 * The amounts are nullable because the alternative was worse: the estimator
 * used to multiply tokens by a flat per-*provider* rate and ignore the model
 * that ran, so two models on one provider — here, a 12x price difference —
 * reported the same cost. A number nobody can stand behind is not better than
 * no number, so an unpriced model reports null and says which model it was.
 */
export interface CostEstimate {
  provider: ProviderId;
  model: string;
  inputCostUsd: number | null;
  outputCostUsd: number | null;
  totalCostUsd: number | null;
  pricing: CostPricing;
}

/* ── Cache ────────────────────────────────────────────────────────────── */

export interface CacheEntry {
  key: string;
  response: ModelCallResult;
  createdAt: string;
  hits: number;
}

export interface CacheStats {
  size: number;
  hits: number;
  misses: number;
  hitRate: number;
}

/* ── Retry ────────────────────────────────────────────────────────────── */

export type RetryableErrorKind =
  'network' | 'timeout' | 'invalid-json' | 'malformed-response' | 'rate-limit' | 'unknown';

export interface RetryAttempt {
  attempt: number;
  errorKind: RetryableErrorKind;
  message: string;
  delayMs: number;
}

/* ── Response validation ──────────────────────────────────────────────── */

export interface ValidationIssue {
  path: string;
  message: string;
  kind: 'missing' | 'type-mismatch' | 'hallucinated' | 'incomplete';
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

/* ── Generation requests + history ───────────────────────────────────── */

export type GenerationStatus = 'success' | 'failed' | 'cached';

export interface GenerationRecord {
  id: string;
  timestamp: string;
  promptId: string;
  provider: ProviderId;
  model: string;
  complexity: TaskComplexity;
  tokens: ModelUsage;
  cost: CostEstimate;
  durationMs: number;
  status: GenerationStatus;
  cacheHit: boolean;
  retries: number;
  validation: ValidationResult;
  version: number;
  error?: string | undefined;
}

/** An image sent with a prompt, already encoded as a `data:` URL. */
export interface PromptImage {
  dataUrl: string;
  /** What the image is to the caller — shown to the model as context. */
  label: string;
}

export interface GenerateRequest {
  promptId: string;
  variables: PromptVariables;
  complexity: TaskComplexity;
  context?: ContextInputs | undefined;
  schema?:
    'requirement-spec' | 'architecture-plan' | 'database-design' | 'generic-json' | undefined;
  /**
   * Reference images for the model to read. Only providers that declare
   * `supportsImages` may receive these; the orchestrator refuses rather than
   * dropping them, because a dropped image means a fabricated analysis.
   */
  images?: readonly PromptImage[] | undefined;
}

export interface GenerateResponse {
  record: GenerationRecord;
  content: string;
  contextPackage: ContextPackage | null;
  compression: CompressionResult | null;
}

/* ── Workflow engine ──────────────────────────────────────────────────── */

export type WorkflowStepKind = 'ai' | 'pipeline-reference';

export interface WorkflowStepDefinition {
  name: string;
  kind: WorkflowStepKind;
  /** For 'ai' steps — which prompt template this step renders and sends. */
  promptId?: string;
  complexity?: TaskComplexity;
  /** For 'pipeline-reference' steps — the deterministic Phase 2-8 stage this step represents (already run by the caller; tracked here for history/visibility only). */
  pipelineModule?: string;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStepDefinition[];
}

export type WorkflowStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface WorkflowStepResult {
  name: string;
  kind: WorkflowStepKind;
  status: WorkflowStepStatus;
  durationMs: number;
  generationId?: string | undefined;
  error?: string | undefined;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  startedAt: string;
  completedAt: string | null;
  status: 'running' | 'completed' | 'failed';
  steps: WorkflowStepResult[];
}

export interface WorkflowStepInput {
  name: string;
  /** Present for 'ai' steps — variables to render the step's prompt template with. */
  variables?: PromptVariables | undefined;
  context?: ContextInputs | undefined;
  /** Present for 'pipeline-reference' steps to mark them already complete (the caller ran that phase itself). */
  completed?: boolean | undefined;
}

/* ── Statistics ───────────────────────────────────────────────────────── */

export interface CostAnalytics {
  totalGenerations: number;
  totalTokens: number;
  averageTokens: number;
  totalCostUsd: number;
  /**
   * Calls whose model has no published price. They are excluded from
   * `totalCostUsd`, so a reader can tell a complete total from a partial one
   * instead of reading an understated number as the whole bill.
   */
  unpricedGenerations: number;
  averageCostUsd: number;
  averageDurationMs: number;
  cache: CacheStats;
  byProvider: Partial<Record<ProviderId, { generations: number; tokens: number; costUsd: number }>>;
  byComplexity: Partial<Record<TaskComplexity, number>>;
}
