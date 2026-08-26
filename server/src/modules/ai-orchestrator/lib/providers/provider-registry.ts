/**
 * Every provider adapter, keyed by id. The model router and orchestrator
 * only ever depend on this registry and the `ModelProvider` interface —
 * never on a concrete provider class — so adding a fifth provider (or a
 * real local-model adapter, the "Local Models (future)" slot `mock`
 * already occupies structurally) never touches call sites.
 */
import type { ModelProvider, ProviderId } from '../../ai-orchestrator.types.js';
import { ClaudeProvider } from './claude-provider.js';
import { GeminiProvider } from './gemini-provider.js';
import { GroqProvider } from './groq-provider.js';
import { MockProvider } from './mock-provider.js';
import { OpenAiProvider } from './openai-provider.js';
import { OpenRouterProvider } from './openrouter-provider.js';

const registry = new Map<ProviderId, ModelProvider>([
  ['groq', new GroqProvider()],
  ['claude', new ClaudeProvider()],
  ['openai', new OpenAiProvider()],
  ['gemini', new GeminiProvider()],
  ['openrouter', new OpenRouterProvider()],
  ['mock', new MockProvider()],
]);

export function getProvider(id: ProviderId): ModelProvider {
  const provider = registry.get(id);
  if (!provider) throw new Error(`Unknown provider "${id}"`);
  return provider;
}

export function listProviders(): ModelProvider[] {
  return [...registry.values()];
}

/** The best available provider for a preferred/fallback pair — falls back to `mock` so a call is always servable. */
export function resolveProvider(preferred: ProviderId, fallback?: ProviderId): ModelProvider {
  const primary = getProvider(preferred);
  if (primary.isConfigured()) return primary;

  if (fallback) {
    const secondary = getProvider(fallback);
    if (secondary.isConfigured()) return secondary;
  }

  return getProvider('mock');
}
