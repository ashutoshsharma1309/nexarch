/**
 * Token estimation — `chars / 4` is the standard rough English/code
 * approximation (both Anthropic and OpenAI cite it for quick estimates),
 * exact enough for a pre-call budget check and a savings ratio even though
 * it isn't exact for a single count. Real usage always comes back from the
 * provider's own response; this is only ever used *before* a call exists.
 */
import type { TokenEstimate } from '../ai-orchestrator.types.js';

const CHARS_PER_TOKEN = 4;
/** Rough multiplier of input size a well-scoped generation response tends to run — not a hard cap. */
const OUTPUT_TO_INPUT_RATIO = 0.6;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function estimateRequestTokens(promptText: string, maxOutputTokens: number): TokenEstimate {
  const inputTokens = estimateTokens(promptText);
  const estimatedOutputTokens = Math.min(
    maxOutputTokens,
    Math.ceil(inputTokens * OUTPUT_TO_INPUT_RATIO),
  );
  return { inputTokens, estimatedOutputTokens, totalTokens: inputTokens + estimatedOutputTokens };
}
