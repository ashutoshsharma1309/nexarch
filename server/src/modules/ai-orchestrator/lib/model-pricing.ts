/**
 * Published list prices for the models this platform actually routes to, in
 * USD per million tokens.
 *
 * A price belongs to a model, not to a provider. Groq serves
 * `openai/gpt-oss-20b` at $0.30 per million output tokens and
 * `qwen/qwen3.8-27b` at $4.00 — a 13x spread behind one API key — so no
 * single pair of numbers attached to the Groq adapter can describe either
 * call. That is the mistake this table exists to replace.
 *
 * A model absent from this table has no price here, and `estimateCost`
 * reports its cost as unknown rather than borrowing a neighbour's rate.
 * Adding a model means looking its price up and recording where from, so a
 * stale entry can be re-checked instead of guessed at.
 *
 * Sources, each read on 2026-10-20:
 *   - Groq models and pricing: https://console.groq.com/docs/models
 *   - Anthropic pricing: https://platform.claude.com/docs/en/about-claude/pricing
 *   - OpenAI pricing: https://developers.openai.com/api/docs/pricing
 *
 * Deliberately absent, because no flat pair of numbers is true for them:
 *   - `gemini-2.5-pro` — Google tiers the rate by prompt length ($1.25/$10
 *     per million up to 200k input tokens, $2.50/$15 above it). Pricing it
 *     flat would be right only for short prompts.
 *   - `openrouter/auto` — OpenRouter chooses the underlying model per
 *     request, so the price is not derivable from the id at all.
 * Both consequently report an unknown cost, which is the honest answer.
 */

/** One model's published rates. `source` records where the numbers came from so they can be re-verified. */
export interface ModelPrice {
  readonly inputPerMillion: number;
  readonly outputPerMillion: number;
  readonly source: string;
}

const GROQ_DOCS = 'console.groq.com/docs/models (read 2026-10-20)';
const ANTHROPIC_DOCS = 'platform.claude.com/docs/en/about-claude/pricing (read 2026-10-20)';
const OPENAI_DOCS = 'developers.openai.com/api/docs/pricing (read 2026-10-20)';

const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  // Groq is the provider a default install configures with one key, and
  // these are the three ids `model-router.ts` ships: fast, deep, vision.
  'openai/gpt-oss-20b': { inputPerMillion: 0.075, outputPerMillion: 0.3, source: GROQ_DOCS },
  'openai/gpt-oss-120b': { inputPerMillion: 0.15, outputPerMillion: 0.6, source: GROQ_DOCS },
  // Groq lists this one as a preview model, so of the entries here it is
  // the likeliest to move or disappear.
  'qwen/qwen3.8-27b': { inputPerMillion: 0.8, outputPerMillion: 4, source: GROQ_DOCS },

  // `AI_FALLBACK_PROVIDER` defaults to `claude`, and that adapter's
  // `defaultModel` is this one — a shipped path, not just an env-reachable one.
  'claude-sonnet-5': { inputPerMillion: 2, outputPerMillion: 10, source: ANTHROPIC_DOCS },

  // Reached by setting `AI_PROVIDER=openai`, whose adapter defaults to `gpt-5`.
  'gpt-5': { inputPerMillion: 1.25, outputPerMillion: 10, source: OPENAI_DOCS },

  // The offline provider performs no inference and opens no connection, so
  // zero here is a known rate rather than a missing one — which keeps the
  // test suite's totals at a truthful $0 instead of "unknown".
  'mock-1': { inputPerMillion: 0, outputPerMillion: 0, source: 'runs no inference' },
};

export function lookupModelPrice(model: string): ModelPrice | null {
  return MODEL_PRICES[model] ?? null;
}
