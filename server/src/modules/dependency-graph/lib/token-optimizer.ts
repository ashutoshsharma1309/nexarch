/**
 * Estimates how many LLM tokens a regeneration would cost if it were
 * scoped to only the affected files versus the whole project. No tokenizer
 * dependency — `chars / 4` is the standard rough English/code approximation
 * (OpenAI and Anthropic both cite it as a quick estimate), which is exact
 * enough for a *savings ratio* even though it isn't exact for a single
 * count. Identical file content across the project (a duplicated
 * component, a copy-pasted service) is only counted once — content a
 * caller wouldn't need to re-send twice either.
 */
import type { TokenOptimization } from '../dependency-graph.types.js';
import type { ScannedFile } from './project-scanner.js';

/** Rough blended input-token rate across mid-tier hosted LLMs, for an order-of-magnitude cost estimate — not a billing figure. */
const USD_PER_TOKEN = 0.000003;

export function estimateTokens(content: string): number {
  return Math.ceil(content.length / 4);
}

function uniqueTokenTotal(files: readonly ScannedFile[]): { tokens: number; duplicates: number } {
  const seen = new Set<string>();
  let tokens = 0;
  let duplicates = 0;
  for (const file of files) {
    if (seen.has(file.content)) {
      duplicates += 1;
      continue;
    }
    seen.add(file.content);
    tokens += estimateTokens(file.content);
  }
  return { tokens, duplicates };
}

export function computeTokenOptimization(
  allFiles: readonly ScannedFile[],
  affectedFiles: readonly ScannedFile[],
): TokenOptimization {
  const full = uniqueTokenTotal(allFiles);
  const affected = uniqueTokenTotal(affectedFiles);
  const tokensSaved = Math.max(0, full.tokens - affected.tokens);
  const savingsPercent =
    full.tokens > 0 ? Math.round((tokensSaved / full.tokens) * 10000) / 100 : 0;

  return {
    fullProjectFiles: allFiles.length,
    fullProjectTokensEstimate: full.tokens,
    affectedFiles: affectedFiles.length,
    affectedTokensEstimate: affected.tokens,
    duplicatesRemoved: full.duplicates,
    tokensSaved,
    savingsPercent,
    estimatedCostSavedUsd: Math.round(tokensSaved * USD_PER_TOKEN * 10000) / 10000,
  };
}
