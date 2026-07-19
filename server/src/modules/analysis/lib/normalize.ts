/**
 * Text primitives shared by the detection pipeline. Matching is always done
 * on normalized text with word boundaries — "cart" must not match "cartel".
 */

/** Lowercase, strip punctuation to spaces, collapse whitespace. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const regexCache = new Map<string, RegExp>();

function phraseRegex(phrase: string): RegExp {
  let cached = regexCache.get(phrase);
  if (!cached) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    cached = new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`);
    regexCache.set(phrase, cached);
  }
  return cached;
}

/** Whole-word/phrase containment on already-normalized text. */
export function containsPhrase(normalizedText: string, phrase: string): boolean {
  return phraseRegex(phrase).test(normalizedText);
}

/** First phrase from the list found in the text, or null. */
export function findPhrase(normalizedText: string, phrases: readonly string[]): string | null {
  for (const phrase of phrases) {
    if (containsPhrase(normalizedText, phrase)) return phrase;
  }
  return null;
}

export function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .map((word) => (word.length > 0 ? `${word.charAt(0).toUpperCase()}${word.slice(1)}` : word))
    .join(' ');
}

// Generic naming/string helpers live in shared; re-exported here so the
// analysis pipeline keeps a single import surface for text primitives.
export { dedupe, singularize } from '../../../shared/utils/strings.js';
