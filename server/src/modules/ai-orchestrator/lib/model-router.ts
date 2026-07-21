/**
 * Picks a provider + model for a task complexity from a data-driven
 * routing table — never a per-provider `if` branch. Swapping which model
 * handles "large-planning" work, or adding a fifth provider, is a table
 * edit, not a code change; that's what "model switching should require
 * configuration only" means in practice.
 */
import type { ModelRouteRule, TaskComplexity } from '../ai-orchestrator.types.js';
import type { ModelProvider } from '../ai-orchestrator.types.js';
import { resolveProvider } from './providers/provider-registry.js';

/**
 * Fast/cheap models handle simple extraction and small, well-scoped
 * regenerations; large models handle whole-project planning and
 * refactors that need to reason about many interacting files at once.
 */
export const DEFAULT_ROUTES: ModelRouteRule[] = [
  {
    complexity: 'simple-extraction',
    provider: 'claude',
    model: 'claude-haiku-4-5-20251001',
    fallbackProvider: 'openai',
    fallbackModel: 'gpt-5-mini',
  },
  {
    complexity: 'large-planning',
    provider: 'claude',
    model: 'claude-opus-4-8',
    fallbackProvider: 'gemini',
    fallbackModel: 'gemini-2.5-pro',
  },
  {
    complexity: 'small-file-regen',
    provider: 'claude',
    model: 'claude-haiku-4-5-20251001',
    fallbackProvider: 'openai',
    fallbackModel: 'gpt-5-mini',
  },
  {
    complexity: 'complex-refactor',
    provider: 'claude',
    model: 'claude-opus-4-8',
    fallbackProvider: 'gemini',
    fallbackModel: 'gemini-2.5-pro',
  },
];

export interface RoutedModel {
  provider: ModelProvider;
  model: string;
  rule: ModelRouteRule;
}

export class ModelRouter {
  constructor(private readonly routes: readonly ModelRouteRule[] = DEFAULT_ROUTES) {}

  route(complexity: TaskComplexity): RoutedModel {
    const rule = this.routes.find((r) => r.complexity === complexity);
    if (!rule) throw new Error(`No route configured for task complexity "${complexity}"`);

    const provider = resolveProvider(rule.provider, rule.fallbackProvider);
    const model =
      provider.id === rule.provider ? rule.model : (rule.fallbackModel ?? provider.defaultModel);

    return { provider, model: provider.id === 'mock' ? provider.defaultModel : model, rule };
  }
}
