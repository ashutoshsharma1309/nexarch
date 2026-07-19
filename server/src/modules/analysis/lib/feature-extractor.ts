/**
 * Feature extraction: everything the prompt states *explicitly*, independent
 * of the detected domain. The spec builder later merges these facts with
 * domain defaults — extraction itself never assumes.
 */
import type { ExtractedFeatures } from '../analysis.types.js';
import {
  AUTH_GENERIC_PHRASES,
  AUTH_LEXICON,
  BACKEND_LEXICON,
  FRONTEND_LEXICON,
  INTEGRATION_LEXICON,
  MODULE_LEXICON,
  ROLE_LEXICON,
} from './lexicon.js';
import type { LexiconEntry } from './lexicon.js';
import { dedupe, findPhrase } from './normalize.js';

function matchLexicon(
  normalizedPrompt: string,
  lexicon: readonly LexiconEntry[],
  signals: string[],
): string[] {
  const labels: string[] = [];
  for (const entry of lexicon) {
    const hit = findPhrase(normalizedPrompt, entry.phrases);
    if (hit !== null) {
      labels.push(entry.label);
      signals.push(hit);
    }
  }
  return labels;
}

export function extractFeatures(normalizedPrompt: string): ExtractedFeatures {
  const signals: string[] = [];

  const authMethods = matchLexicon(normalizedPrompt, AUTH_LEXICON, signals);
  const genericAuthHit = findPhrase(normalizedPrompt, AUTH_GENERIC_PHRASES);
  if (genericAuthHit !== null) {
    signals.push(genericAuthHit);
  }

  const roles = matchLexicon(normalizedPrompt, ROLE_LEXICON, signals);
  const modules = matchLexicon(normalizedPrompt, MODULE_LEXICON, signals);
  const integrations = matchLexicon(normalizedPrompt, INTEGRATION_LEXICON, signals);
  const backend = matchLexicon(normalizedPrompt, BACKEND_LEXICON, signals);
  const frontend = matchLexicon(normalizedPrompt, FRONTEND_LEXICON, signals);

  return {
    roles,
    modules,
    authNeeded: genericAuthHit !== null || authMethods.length > 0,
    authMethods,
    integrations,
    backend,
    frontend,
    signals: dedupe(signals),
  };
}
