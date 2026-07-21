/**
 * Compresses a rendered prompt before it's sent: collapses runs of blank
 * lines, strips line comments from file blocks (the model is reading
 * these as reference material, not executing them — losing a `//` comment
 * costs nothing a working example doesn't already convey), and drops
 * duplicate lines repeated back-to-back (a common artifact of concatenating
 * several near-identical file blocks).
 */
import type { CompressionResult } from '../ai-orchestrator.types.js';
import { estimateTokens } from './token-estimator.js';

const BLANK_LINES = /\n{3,}/g;
const LINE_COMMENT = /^\s*\/\/.*$/;
const TRAILING_WHITESPACE = /[ \t]+$/gm;

function stripLineComments(text: string): string {
  return text
    .split('\n')
    .filter((line) => !LINE_COMMENT.test(line))
    .join('\n');
}

function collapseDuplicateLines(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 0 && result.at(-1)?.trim() === trimmed) continue;
    result.push(line);
  }
  return result.join('\n');
}

export function compressPrompt(text: string): CompressionResult {
  const originalTokens = estimateTokens(text);

  const compressed = collapseDuplicateLines(
    stripLineComments(text).replace(TRAILING_WHITESPACE, '').replace(BLANK_LINES, '\n\n'),
  ).trim();

  const compressedTokens = estimateTokens(compressed);
  const savingsPercent =
    originalTokens > 0
      ? Math.round(((originalTokens - compressedTokens) / originalTokens) * 10000) / 100
      : 0;

  return { text: compressed, originalTokens, compressedTokens, savingsPercent };
}
