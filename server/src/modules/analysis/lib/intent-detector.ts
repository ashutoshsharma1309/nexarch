/**
 * Intent detection: classify the prompt into a domain profile.
 *
 * Additive keyword scoring — strong keywords (domain names and their
 * synonyms) weigh 3, weak keywords (corroborating vocabulary) weigh 1.
 * The margin between the best and second-best profile drives confidence,
 * and the matched phrases are returned so every classification is
 * explainable in the API response and the logs.
 */
import type { DetectionConfidence } from '../analysis.types.js';
import { DOMAIN_PROFILES } from './knowledge-base.js';
import type { DomainProfile } from './knowledge-base.js';
import { containsPhrase } from './normalize.js';

const STRONG_WEIGHT = 3;
const WEAK_WEIGHT = 1;

export interface IntentDetection {
  profile: DomainProfile | null;
  confidence: DetectionConfidence;
  matchedKeywords: string[];
}

interface ProfileScore {
  profile: DomainProfile;
  score: number;
  matches: string[];
}

function scoreProfile(normalizedPrompt: string, profile: DomainProfile): ProfileScore {
  let score = 0;
  const matches: string[] = [];

  for (const keyword of profile.strongKeywords) {
    if (containsPhrase(normalizedPrompt, keyword)) {
      score += STRONG_WEIGHT;
      matches.push(keyword);
    }
  }
  for (const keyword of profile.weakKeywords) {
    if (containsPhrase(normalizedPrompt, keyword)) {
      score += WEAK_WEIGHT;
      matches.push(keyword);
    }
  }

  return { profile, score, matches };
}

export function detectIntent(normalizedPrompt: string): IntentDetection {
  const scored = DOMAIN_PROFILES.map((profile) => scoreProfile(normalizedPrompt, profile))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best) {
    return { profile: null, confidence: 'low', matchedKeywords: [] };
  }

  // Weak-keyword-only matches (score < STRONG_WEIGHT) are circumstantial:
  // "orders and products" alone shouldn't lock in a domain.
  if (best.score < STRONG_WEIGHT) {
    return { profile: null, confidence: 'low', matchedKeywords: best.matches };
  }

  const runnerUp = scored[1]?.score ?? 0;
  const margin = best.score - runnerUp;
  const confidence: DetectionConfidence = margin >= 3 ? 'high' : margin >= 1 ? 'medium' : 'low';

  return { profile: best.profile, confidence, matchedKeywords: best.matches };
}
