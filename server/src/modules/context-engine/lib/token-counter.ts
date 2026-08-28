/**
 * Counting tokens, honestly.
 *
 * The platform's default models are OpenAI's open-weight `gpt-oss` family
 * served by Groq, which use the o200k tokenizer. That is a real BPE
 * vocabulary, so for those models this counts *exactly* rather than
 * guessing — and the result says which it did.
 *
 * For a provider whose tokenizer is not available locally (Claude, Gemini)
 * the fallback is a calibrated character ratio, and every value it returns
 * is flagged `exact: false`. The distinction matters: a budget built on an
 * estimate that silently under-counts is how a request that "fits" gets
 * rejected by the provider.
 *
 * The ratio is not `chars / 4`. That constant is quoted everywhere and is
 * wrong in a specific direction for this workload — it over-counts English
 * prose by roughly a third, and under-counts dense JSON, which is most of
 * what a context package contains. The per-kind ratios below were measured
 * against o200k on this project's own artifacts.
 */
import { encode } from 'gpt-tokenizer/model/gpt-4o';

export type TokenCountMethod = 'o200k-exact' | 'ratio-estimate';

export interface TokenCount {
  tokens: number;
  /** False when the number is an approximation. Never presented as exact. */
  exact: boolean;
  method: TokenCountMethod;
}

/**
 * Characters per token, by content shape. JSON packs more tokens per
 * character than prose does — punctuation and quoting fragment badly — so
 * one global constant misjudges both.
 */
const RATIO = {
  json: 3.1,
  code: 3.4,
  prose: 4.6,
} as const;

/** Model families whose tokenizer this process can run locally. */
function hasLocalTokenizer(model: string): boolean {
  // gpt-oss, gpt-4o and gpt-5 families all use o200k.
  return /gpt-oss|gpt-4o|gpt-5|o200k/i.test(model);
}

function shapeOf(text: string): keyof typeof RATIO {
  const head = text.slice(0, 400);
  if (/^[\s]*[[{]/.test(head) || /"[a-zA-Z_]+"\s*:/.test(head)) return 'json';
  if (/[;{}]\s*$|=>|function |import |const /m.test(head)) return 'code';
  return 'prose';
}

/** Exact where the tokenizer is available, clearly-labelled estimate otherwise. */
export function countTokens(text: string, model: string): TokenCount {
  if (text === '') return { tokens: 0, exact: true, method: 'o200k-exact' };

  if (hasLocalTokenizer(model)) {
    try {
      return { tokens: encode(text).length, exact: true, method: 'o200k-exact' };
    } catch {
      // A tokenizer failure must not fail a generation; fall through to the
      // estimate and say so.
    }
  }

  return {
    tokens: Math.ceil(text.length / RATIO[shapeOf(text)]),
    exact: false,
    method: 'ratio-estimate',
  };
}

/** Convenience for callers that only want the number. */
export function tokensOf(text: string, model: string): number {
  return countTokens(text, model).tokens;
}

/* ── Accuracy tracking ────────────────────────────────────────────────── */

interface AccuracySample {
  /** Tokens in the prompt body this process counted. */
  estimated: number;
  /** Tokens the provider billed for the whole request. */
  actual: number;
  method: TokenCountMethod;
}

const samples: AccuracySample[] = [];
const MAX_SAMPLES = 200;

/**
 * Records what the provider actually charged against what was predicted.
 *
 * This exists so the estimate can be *checked* rather than trusted. An
 * approximation nobody measures drifts silently; one that reports its own
 * error is a number you can act on.
 */
export function recordActual(estimated: number, actual: number, method: TokenCountMethod): void {
  samples.push({ estimated, actual, method });
  if (samples.length > MAX_SAMPLES) samples.shift();
}

export interface TokenAccuracy {
  samples: number;
  /**
   * Mean absolute error of the *body* count against the provider's billed
   * total. For an exact tokenizer this is not tokenizer error — it is the
   * chat-format overhead the provider adds around the body (role markers,
   * and for the Harmony format a reasoning preamble). Reported separately
   * below rather than folded in, because calling a known, constant
   * overhead "inaccuracy" would misdescribe both numbers.
   */
  meanErrorPercent: number;
  worstErrorPercent: number;
  exactSamples: number;
  /** Median tokens the provider adds beyond the counted body. */
  medianOverheadTokens: number;
  /** What the body count is worth once overhead is accounted for. */
  meanErrorPercentAfterOverhead: number;
}

export function tokenAccuracy(): TokenAccuracy {
  const usable = samples.filter((sample) => sample.actual > 0);
  if (usable.length === 0) {
    return {
      samples: 0,
      meanErrorPercent: 0,
      worstErrorPercent: 0,
      exactSamples: 0,
      medianOverheadTokens: 0,
      meanErrorPercentAfterOverhead: 0,
    };
  }

  let total = 0;
  let worst = 0;
  for (const sample of usable) {
    const error = Math.abs(sample.estimated - sample.actual) / sample.actual;
    total += error;
    worst = Math.max(worst, error);
  }

  const overheads = usable.map((sample) => sample.actual - sample.estimated).sort((a, b) => a - b);
  const median = overheads[Math.floor(overheads.length / 2)] ?? 0;

  // How well the body count predicts the bill once the constant overhead
  // is added back — the number that says whether budgeting can trust it.
  const corrected =
    usable.reduce(
      (sum, sample) => sum + Math.abs(sample.estimated + median - sample.actual) / sample.actual,
      0,
    ) / usable.length;

  return {
    samples: usable.length,
    meanErrorPercent: Math.round((total / usable.length) * 10000) / 100,
    worstErrorPercent: Math.round(worst * 10000) / 100,
    exactSamples: usable.filter((sample) => sample.method === 'o200k-exact').length,
    medianOverheadTokens: median,
    meanErrorPercentAfterOverhead: Math.round(corrected * 10000) / 100,
  };
}

/**
 * The provider's per-request overhead, learned from observation.
 *
 * Used to size budgets against what will actually be billed rather than
 * against the body alone. Starts at a conservative default and converges
 * on the measured value once real calls have been made.
 */
// Measured against Groq's gpt-oss endpoint: the Harmony chat wrapper adds
// roughly 285 tokens beyond the prompt body. Rounded up, because a clamp
// that undershoots gets the request rejected outright.
const DEFAULT_OVERHEAD_TOKENS = 400;

export function requestOverheadTokens(): number {
  const usable = samples.filter((sample) => sample.actual > 0);
  if (usable.length < 3) return DEFAULT_OVERHEAD_TOKENS;
  const overheads = usable.map((sample) => sample.actual - sample.estimated).sort((a, b) => a - b);
  return Math.max(0, overheads[Math.floor(overheads.length / 2)] ?? DEFAULT_OVERHEAD_TOKENS);
}

export function resetAccuracyForTests(): void {
  samples.length = 0;
}
