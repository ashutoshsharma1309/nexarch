/**
 * Contracts for the Requirement Analysis module.
 *
 * `AnalysisResult` is a discriminated union: a prompt either yields a full
 * `RequirementSpec` (the input the Architecture Planner consumes in the next
 * pipeline stage) or an `INCOMPLETE` verdict carrying the clarifying
 * questions the user must answer first. The client mirrors these types.
 */

// The produced specification is the cross-stage pipeline contract and lives
// in shared/types; re-exported so this module's public shape is unchanged.
export type { RequirementSpec } from '../../shared/types/requirement.js';
import type { RequirementSpec } from '../../shared/types/requirement.js';

/** How confident the intent detector is about the classified project type. */
export type DetectionConfidence = 'high' | 'medium' | 'low';

export interface DetectionSummary {
  projectType: string | null;
  confidence: DetectionConfidence;
  /** The phrases in the prompt that drove classification — explainability. */
  matchedSignals: string[];
}

export interface CompleteAnalysis {
  status: 'COMPLETE';
  spec: RequirementSpec;
  detection: DetectionSummary;
}

export interface IncompleteAnalysis {
  status: 'INCOMPLETE';
  questions: string[];
  detection: DetectionSummary;
}

export type AnalysisResult = CompleteAnalysis | IncompleteAnalysis;

/** Requirement facets a clarifying question can target. Questions about a
 * facet the prompt already covers are filtered out before responding. */
export type QuestionAspect = 'roles' | 'modules' | 'auth' | 'payments' | 'integrations';

export interface ClarifyingQuestion {
  aspect: QuestionAspect;
  text: string;
}

/** Everything the feature extractor found explicitly stated in the prompt. */
export interface ExtractedFeatures {
  roles: string[];
  modules: string[];
  authNeeded: boolean;
  authMethods: string[];
  integrations: string[];
  backend: string[];
  frontend: string[];
  /** Union of every matched phrase, for detection summaries and logging. */
  signals: string[];
}
