/**
 * Requirement Parser Service — orchestrates the analysis pipeline:
 *
 *   normalize → detect intent → extract features → evaluate completeness
 *             → build spec (or return clarifying questions)
 *
 * The service is pure and deterministic: same prompt, same result, no I/O.
 * That makes it exactly-assertable in tests, and it is the seam where an
 * LLM-backed analyzer can slot in later behind the same signature without
 * touching the router or the client.
 */
import { logger } from '../../shared/logger/index.js';
import type { AnalysisResult, DetectionSummary } from './analysis.types.js';
import { evaluateCompleteness } from './lib/completeness.js';
import { extractFeatures } from './lib/feature-extractor.js';
import { detectIntent } from './lib/intent-detector.js';
import { normalize } from './lib/normalize.js';
import { buildSpec } from './lib/spec-builder.js';

export function analyzeRequirements(prompt: string): AnalysisResult {
  const startedAt = performance.now();
  const normalizedPrompt = normalize(prompt);

  const intent = detectIntent(normalizedPrompt);
  const features = extractFeatures(normalizedPrompt);

  const detection: DetectionSummary = {
    projectType: intent.profile?.type ?? null,
    confidence: intent.confidence,
    matchedSignals: [...new Set([...intent.matchedKeywords, ...features.signals])],
  };

  const verdict = evaluateCompleteness(intent.profile, features);
  const durationMs = Math.round(performance.now() - startedAt);

  if (!verdict.complete) {
    logger.info('requirement analysis: incomplete prompt', {
      projectType: detection.projectType,
      questions: verdict.questions.length,
      durationMs,
    });
    return { status: 'INCOMPLETE', questions: verdict.questions, detection };
  }

  const spec = buildSpec(prompt, normalizedPrompt, intent.profile, features);

  logger.info('requirement analysis: spec produced', {
    projectType: spec.projectType,
    confidence: detection.confidence,
    modules: spec.modules.length,
    durationMs,
  });

  return { status: 'COMPLETE', spec, detection };
}
