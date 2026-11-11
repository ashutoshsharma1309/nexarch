/**
 * Picks a provider + model for a task complexity from a data-driven
 * routing table — never a per-provider `if` branch. Swapping which model
 * handles "large-planning" work, or adding a fifth provider, is a table
 * edit, not a code change; that's what "model switching should require
 * configuration only" means in practice.
 */
import type { ModelRouteRule, ProviderId, TaskComplexity } from '../ai-orchestrator.types.js';
import type { ModelProvider } from '../ai-orchestrator.types.js';
import { getProvider } from './providers/provider-registry.js';

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
const PROVIDER_IDS: ProviderId[] = [
  'groq',
  'claude',
  'openai',
  'gemini',
  'openrouter',
  'cerebras',
  'mock',
];

type ModelTier = 'fast' | 'deep' | 'vision';

/**
 * What each provider calls each tier. A provider with no `vision` entry is
 * left out of the vision chain, and one absent here uses its adapter default.
 * `AI_MODEL_<PROVIDER>_<TIER>` overrides any cell, because these ids retire.
 *
 * The Gemini and OpenRouter rows are the fastest models that answered this
 * platform's real prompts on the keys in use on 2026-11-09; gemini-3.8-flash
 * wrote slightly better copy but took 50s and then timed out past 90s.
 */
const PROVIDER_MODELS: Partial<Record<ProviderId, Partial<Record<ModelTier, string>>>> = {
  groq: { fast: 'openai/gpt-oss-20b', deep: 'openai/gpt-oss-120b', vision: 'qwen/qwen3.8-27b' },
  cerebras: { fast: 'gpt-oss-120b', deep: 'gpt-oss-120b' },
  gemini: { fast: 'gemini-3.5-flash', deep: 'gemini-3.5-flash' },
  openrouter: {
    fast: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    deep: 'nvidia/nemotron-3-ultra-550b-a55b:free',
  },
};

function envProvider(name: string, fallback: ProviderId): ProviderId {
  const raw = process.env[name]?.trim();
  return raw && (PROVIDER_IDS as string[]).includes(raw) ? (raw as ProviderId) : fallback;
}

function envValue(name: string): string | undefined {
  const raw = process.env[name]?.trim();
  return raw === undefined || raw === '' ? undefined : raw;
}

/** `AI_PROVIDER_CHAIN=groq,gemini` as ids, unknown names dropped. */
function envChain(name: string): ProviderId[] {
  return (process.env[name] ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry): entry is ProviderId => (PROVIDER_IDS as string[]).includes(entry));
}

/** Provider-specific override, then the generic one for `AI_PROVIDER`, then the table. */
function modelFor(provider: ProviderId, tier: ModelTier, primary: ProviderId): string | undefined {
  const suffix = tier.toUpperCase();
  return (
    envValue(`AI_MODEL_${provider.toUpperCase()}_${suffix}`) ??
    (provider === primary ? envValue(`AI_MODEL_${suffix}`) : undefined) ??
    PROVIDER_MODELS[provider]?.[tier]
  );
}

/** Read at call time, not module load, so tests and `.env` edits both take effect. */
export function defaultRoutes(): ModelRouteRule[] {
  // The test suite must never reach a network provider: a developer with a
  // real key in `.env` would otherwise turn `npm test` into billed, flaky,
  // offline-hostile calls. Under test the router pins to the deterministic
  // provider, whatever the environment says.
  if (process.env.NODE_ENV === 'test') {
    return (
      [
        'simple-extraction',
        'large-planning',
        'small-file-regen',
        'complex-refactor',
        'vision-analysis',
        'research-synthesis',
      ] as const
    ).map((complexity) => ({ complexity, provider: 'mock' as const, model: 'mock-1' }));
  }

  const primary = envProvider('AI_PROVIDER', 'groq');
  // Planning and customer-facing copy can start somewhere better than the
  // provider that answers extraction fastest.
  const deepPrimary = envProvider('AI_PROVIDER_DEEP', primary);
  // Reasoning over web evidence goes to OpenRouter when a key exists, and
  // otherwise takes the same route as any other deep work.
  const researchPrimary = envProvider(
    'AI_PROVIDER_RESEARCH',
    getProvider('openrouter').isConfigured() ? 'openrouter' : deepPrimary,
  );
  const fallbackProvider = envProvider('AI_FALLBACK_PROVIDER', 'claude');
  const configuredChain = envChain('AI_PROVIDER_CHAIN');
  const chain = configuredChain.length > 0 ? configuredChain : [fallbackProvider];

  const rule = (
    complexity: TaskComplexity,
    tier: ModelTier,
    first: ProviderId,
    next: readonly ProviderId[] = [],
  ): ModelRouteRule => ({
    complexity,
    provider: first,
    model: modelFor(first, tier, primary) ?? getProvider(first).defaultModel,
    fallbackProvider,
    chain: [...new Set([...next, ...chain])]
      .filter((provider) => provider !== first)
      // A text model cannot see: routing an image to one would send the
      // instruction and silently drop the picture.
      .filter((provider) => tier !== 'vision' || modelFor(provider, tier, primary) !== undefined)
      .map((provider) => ({ provider, model: modelFor(provider, tier, primary) })),
  });

  return [
    rule('simple-extraction', 'fast', primary),
    rule('large-planning', 'deep', deepPrimary),
    rule('small-file-regen', 'fast', primary),
    rule('complex-refactor', 'deep', deepPrimary),
    rule('vision-analysis', 'vision', primary),
    // deepPrimary leads the failover because a configured chain need not name it.
    rule('research-synthesis', 'deep', researchPrimary, [deepPrimary]),
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
    return this.candidates(complexity)[0];
  }

  /** Every configured provider for this work, in the order to try them; `mock` when none is. */
  candidates(complexity: TaskComplexity): [RoutedModel, ...RoutedModel[]] {
    const rule = (this.routes ?? defaultRoutes()).find((r) => r.complexity === complexity);
    if (!rule) throw new Error(`No route configured for task complexity "${complexity}"`);

    const steps = [
      { provider: rule.provider, model: rule.model as string | undefined },
      ...(rule.chain ??
        (rule.fallbackProvider
          ? [{ provider: rule.fallbackProvider, model: rule.fallbackModel }]
          : [])),
    ];

    const routed: RoutedModel[] = [];
    for (const step of steps) {
      const provider = getProvider(step.provider);
      if (!provider.isConfigured() || routed.some((r) => r.provider.id === provider.id)) continue;
      const model = provider.id === 'mock' ? provider.defaultModel : step.model;
      routed.push({ provider, model: model ?? provider.defaultModel, rule });
    }

    const [first, ...rest] = routed;
    if (first) return [first, ...rest];

    const mock = getProvider('mock');
    return [{ provider: mock, model: mock.defaultModel, rule }];
  }
}
