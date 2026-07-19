/**
 * Requirement validator: decides whether a prompt carries enough signal to
 * produce a trustworthy specification, and if not, which questions to ask.
 *
 * The bar scales with domain complexity — a portfolio site has safe
 * defaults; a banking system does not get guessed at. Questions targeting
 * facets the prompt already answered are dropped: never ask what you were
 * just told.
 */
import type { ClarifyingQuestion, ExtractedFeatures, QuestionAspect } from '../analysis.types.js';
import { GENERIC_QUESTIONS } from './knowledge-base.js';
import type { DomainProfile } from './knowledge-base.js';

/** Signals required to proceed without questions, per complexity tier. */
const REQUIRED_SIGNALS: Record<DomainProfile['complexity'], number> = {
  simple: 0,
  standard: 1,
  complex: 2,
};

/** Signals required when no domain was recognized at all. */
const REQUIRED_SIGNALS_UNKNOWN_DOMAIN = 2;

export interface CompletenessVerdict {
  complete: boolean;
  questions: string[];
}

function coveredAspects(features: ExtractedFeatures): Set<QuestionAspect> {
  const covered = new Set<QuestionAspect>();
  if (features.roles.length > 0) covered.add('roles');
  if (features.modules.length > 0 || features.backend.length > 0) covered.add('modules');
  if (features.authNeeded) covered.add('auth');
  if (features.integrations.includes('Payment Gateway')) covered.add('payments');
  if (features.integrations.length > 0) covered.add('integrations');
  return covered;
}

export function evaluateCompleteness(
  profile: DomainProfile | null,
  features: ExtractedFeatures,
): CompletenessVerdict {
  const covered = coveredAspects(features);
  const signalCount = (
    ['roles', 'modules', 'auth', 'integrations'] satisfies QuestionAspect[]
  ).filter((aspect) => covered.has(aspect)).length;

  const required = profile ? REQUIRED_SIGNALS[profile.complexity] : REQUIRED_SIGNALS_UNKNOWN_DOMAIN;
  if (signalCount >= required) {
    return { complete: true, questions: [] };
  }

  const source: readonly ClarifyingQuestion[] = profile ? profile.questions : GENERIC_QUESTIONS;
  const questions = source
    .filter((question) => !covered.has(question.aspect))
    .map((question) => question.text);

  return { complete: false, questions };
}
