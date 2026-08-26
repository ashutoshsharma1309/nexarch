/**
 * Picks a provider + model for a task complexity from a data-driven
 * routing table — never a per-provider `if` branch. Swapping which model
 * handles "large-planning" work, or adding a fifth provider, is a table
 * edit, not a code change; that's what "model switching should require
 * configuration only" means in practice.
 */
import type { ModelRouteRule, ProviderId, TaskComplexity } from '../ai-orchestrator.types.js';
import type { ModelProvider } from '../ai-orchestrator.types.js';
import { resolveProvider } from './providers/provider-registry.js';

/**
 * Which model handles which kind of work is configuration, not code. The
 * table below is the shipped default (Groq — the provider a local install
 * configures with a single `AI_API_KEY`); `AI_PROVIDER`, `AI_MODEL_FAST`
 * and `AI_MODEL_DEEP` override it without touching this file, and an
 * unconfigured provider still degrades to `mock` via `resolveProvider`.
 *
 * Fast/cheap models handle simple extraction and small, well-scoped
 * regenerations; larger models handle whole-project planning and
 * refactors that need to reason about many interacting files at once.
 */
const PROVIDER_IDS: ProviderId[] = ['groq', 'claude', 'openai', 'gemini', 'openrouter', 'mock'];

function envProvider(name: string, fallback: ProviderId): ProviderId {
  const raw = process.env[name]?.trim();
  return raw && (PROVIDER_IDS as string[]).includes(raw) ? (raw as ProviderId) : fallback;
}

function envModel(name: string, fallback: string): string {
  const raw = process.env[name]?.trim();
  return raw === undefined || raw === '' ? fallback : raw;
}

/** Read at call time, not module load, so tests and `.env` edits both take effect. */
export function defaultRoutes(): ModelRouteRule[] {
  // The test suite must never reach a network provider: a developer with a
  // real key in `.env` would otherwise turn `npm test` into billed, flaky,
  // offline-hostile calls. Under test the router pins to the deterministic
  // provider, whatever the environment says.
  if (process.env.NODE_ENV === 'test') {
    return (
      ['simple-extraction', 'large-planning', 'small-file-regen', 'complex-refactor'] as const
    ).map((complexity) => ({ complexity, provider: 'mock' as const, model: 'mock-1' }));
  }

  const provider = envProvider('AI_PROVIDER', 'groq');
  const fast = envModel('AI_MODEL_FAST', 'openai/gpt-oss-20b');
  const deep = envModel('AI_MODEL_DEEP', 'openai/gpt-oss-120b');
  const fallbackProvider = envProvider('AI_FALLBACK_PROVIDER', 'claude');

  return [
    { complexity: 'simple-extraction', provider, model: fast, fallbackProvider },
    { complexity: 'large-planning', provider, model: deep, fallbackProvider },
    { complexity: 'small-file-regen', provider, model: fast, fallbackProvider },
    { complexity: 'complex-refactor', provider, model: deep, fallbackProvider },
  ];
}

/** Snapshot of the routing table at import time — kept for callers that want the shape without re-reading env. */
export const DEFAULT_ROUTES: ModelRouteRule[] = defaultRoutes();

export interface RoutedModel {
  provider: ModelProvider;
  model: string;
  rule: ModelRouteRule;
}

export class ModelRouter {
  constructor(private readonly routes?: readonly ModelRouteRule[]) {}

  route(complexity: TaskComplexity): RoutedModel {
    const rule = (this.routes ?? defaultRoutes()).find((r) => r.complexity === complexity);
    if (!rule) throw new Error(`No route configured for task complexity "${complexity}"`);

    const provider = resolveProvider(rule.provider, rule.fallbackProvider);
    const model =
      provider.id === rule.provider ? rule.model : (rule.fallbackModel ?? provider.defaultModel);

    return { provider, model: provider.id === 'mock' ? provider.defaultModel : model, rule };
  }
}
