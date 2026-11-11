/**
 * Contracts for the Web Research engine.
 *
 * A `ResearchArtifact` is plain JSON so it can be persisted and handed to later
 * stages unchanged. It separates what was really read from what a search engine
 * merely summarised, and it says what could not be done, because a design built
 * on research must be able to tell evidence from absence.
 */

/** Bump only with a migration: persisted artifacts are read back by this shape. */
export const RESEARCH_ARTIFACT_VERSION = 1 as const;

export type ResearchDepth = 'standard' | 'deep';
export type ResearchStatus = 'complete' | 'partial' | 'unavailable';
export type ResearchProviderId = 'brave' | 'tavily';
export type RetrievalKind = 'search-snippet' | 'extracted-page' | 'unreachable';
export type ResearchConfidence = 'high' | 'medium' | 'low';

export interface ResearchSource {
  /** Derived from the normalised URL, so the same page has the same id in every run. */
  id: string;
  url: string;
  title: string;
  /** The provider that supplied the content in `excerpt`. */
  provider: ResearchProviderId;
  retrievalKind: RetrievalKind;
  excerpt: string;
  accessedAt: string;
  /** Lines withheld from `excerpt` because they read like prompt injection. */
  flaggedLines: string[];
}

export interface ResearchFinding {
  statement: string;
  sourceIds: string[];
  confidence: ResearchConfidence;
}

export interface ResearchDecision {
  decision: string;
  rationale: string;
  sourceIds: string[];
  confidence: ResearchConfidence;
}

export type ReferenceSectionKind =
  | 'header'
  | 'hero'
  | 'media-grid'
  | 'card-grid'
  | 'split-media'
  | 'media-band'
  | 'text-block'
  | 'form'
  | 'footer'
  | 'other';
export type ReferenceFontKind = 'serif' | 'sans-serif' | 'monospace' | 'script' | 'unknown';
export type ReferenceNavPattern = 'horizontal-bar' | 'vertical-list' | 'hamburger' | 'none';
export type ReferenceHeroLayout =
  'text-over-media' | 'split' | 'stacked' | 'text-only' | 'media-only';

/**
 * What one render measured. Numbers, enums and hex colours only: a page chooses
 * nothing here that could carry its words, code or name into a later prompt.
 */
export interface ReferenceViewportMeasurements {
  viewportWidth: number;
  viewportHeight: number;
  pageHeight: number;
  sections: ReferenceSectionKind[];
  landmarks: { header: number; nav: number; main: number; aside: number; footer: number };
  nav: { items: number; pattern: ReferenceNavPattern; pinned: boolean };
  /** Median size per heading level, largest level first. */
  headings: {
    level: number;
    fontKind: ReferenceFontKind;
    /** Set only for a widely licensed typeface; a custom face may carry a brand's name. */
    fontName: string | null;
    sizePx: number;
    weight: number;
  }[];
  typeScaleRatio: number | null;
  body: {
    fontKind: ReferenceFontKind;
    fontName: string | null;
    sizePx: number;
    lineHeightRatio: number | null;
    measurePx: number | null;
  } | null;
  palette: { hex: string; role: 'background' | 'text' | 'accent'; share: number }[];
  spacing: { commonPx: number[]; baseUnitPx: number | null; sectionGapPx: number | null };
  images: { count: number; areaShare: number };
  hero: {
    layout: ReferenceHeroLayout;
    heightVh: number;
    align: 'left' | 'center' | 'right' | null;
    callsToAction: number;
  } | null;
  motion: {
    transitions: number;
    animations: number;
    pinnedElements: number;
    smoothScroll: boolean;
  };
  maxColumns: number;
  horizontalOverflow: boolean;
}

export interface ReferenceMeasurements {
  desktop: ReferenceViewportMeasurements;
  /** Null when the phone-width render failed; `limitation` says why. */
  mobile: ReferenceViewportMeasurements | null;
}

/** How one reference site is built, from a real render rather than from its text. */
export interface ReferenceAnalysis {
  /** Only the host when the URL was refused, so a credential in it is not kept. */
  url: string;
  accessible: boolean;
  /** Why the analysis is missing or incomplete; null when there is nothing to report. */
  limitation: string | null;
  structure: string;
  typography: string;
  colour: string;
  spacing: string;
  imagery: string;
  navigation: string;
  interactions: string;
  responsive: string;
  /** Optional so an artifact stored before rendering existed still reads back. */
  origin?: 'user' | 'researched';
  measurements?: ReferenceMeasurements;
}

export interface ResearchQueryRecord {
  query: string;
  provider: ResearchProviderId;
  results: number;
  fromCache: boolean;
}

export interface ResearchModelCall {
  purpose: 'planning' | 'synthesis';
  status: 'success' | 'failed';
  provider: string;
  model: string;
  /** Null when the provider did not report a figure. */
  inputTokens: number | null;
  outputTokens: number | null;
  /** Null when this model has no published price. */
  costUsd: number | null;
  cacheHit: boolean;
  durationMs: number;
  /** Set whenever a figure above is unavailable, saying why. */
  note: string | null;
}

export interface ResearchUsage {
  /** Search requests sent outward, failures included. Cache hits are not counted. */
  searches: number;
  /** URLs sent to the extraction API, failures included. Cache hits are not counted. */
  extractions: number;
  extractionRequests: number;
  searchCacheHits: number;
  extractionCacheHits: number;
  byProvider: {
    brave: { searches: number };
    tavily: { searches: number; extractions: number };
  };
  modelCalls: ResearchModelCall[];
  durationMs: number;
  /** Which figures are unavailable and why. */
  notes: string[];
}

export interface ResearchArtifact {
  version: typeof RESEARCH_ARTIFACT_VERSION;
  generatedAt: string;
  objective: string;
  domainLabel: string;
  depth: ResearchDepth;
  status: ResearchStatus;
  limitations: string[];
  /** The engine crashed, so what it spent before stopping is not known. */
  engineFailed?: boolean;
  /** Only the questions research was really run for: empty when no search ran. */
  questions: string[];
  queries: ResearchQueryRecord[];
  sources: ResearchSource[];
  findings: ResearchFinding[];
  commonPatterns: string[];
  visualDirection: string[];
  featureRecommendations: string[];
  uxPatterns: string[];
  interactions: string[];
  assetRequirements: string[];
  implementationRecommendations: string[];
  decisions: ResearchDecision[];
  referenceAnalyses: ReferenceAnalysis[];
  usage: ResearchUsage;
}
