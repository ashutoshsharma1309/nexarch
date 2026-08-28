/**
 * What a generation run did, and what a UX review made of it.
 *
 * These types are the generation mesh's own vocabulary. The generators
 * themselves already describe *what they emit* — `GeneratedProject` and
 * `GeneratedFrontend` carry files, modules, pages and stats — and none of
 * that is repeated here. What was missing is the layer above: which of
 * those files were newly created versus rewritten versus left alone, and
 * whether the resulting interface is one a person could actually use.
 *
 * The distinction matters because a generator that reports "38 files"
 * every run tells you nothing about whether anything changed. A manifest
 * that reports "2 created, 3 updated, 33 preserved" is the difference
 * between a regeneration you can review and one you have to re-read.
 */

import type { AgentId } from '../contracts/agent.js';

/** What happened to one file in one generation run. */
export type FileOperation = 'CREATE' | 'UPDATE' | 'PRESERVE' | 'DELETE';

export interface FileChange {
  path: string;
  operation: FileOperation;
  /** Which agent emitted it, so a file traces back to its author. */
  agentId: AgentId;
  /** Bytes of the new content; 0 for a deletion. */
  sizeBytes: number;
}

/**
 * The generation manifest.
 *
 * `preserved` is the load-bearing entry. A run that regenerates a project
 * must not present unchanged files as work it did, and must not delete a
 * file merely because this run did not emit it — the manifest is where
 * both of those commitments are made checkable.
 */
export interface GenerationManifest {
  projectId: string;
  runId: string;
  generatedAt: string;
  changes: FileChange[];
  totals: {
    created: number;
    updated: number;
    preserved: number;
    deleted: number;
    /** Files in the project after this run, whoever produced them. */
    total: number;
  };
  byAgent: Record<string, { created: number; updated: number; preserved: number }>;
  byArea: { backend: number; frontend: number; shared: number };
}

/* ── UX review ─────────────────────────────────────────────────────────── */

export type UxSeverity = 'HIGH' | 'MEDIUM' | 'LOW';

/**
 * The dimensions the UX engineer reads. Each one is a question a person
 * would ask of a screen, not a lint rule — `STATE` is "does this tell me
 * what it is doing", not "is there a ternary here".
 */
export type UxCategory =
  | 'HIERARCHY'
  | 'NAVIGATION'
  | 'LAYOUT'
  | 'RESPONSIVENESS'
  | 'FORMS'
  | 'STATE'
  | 'ACCESSIBILITY'
  | 'CONSISTENCY'
  | 'TYPOGRAPHY'
  | 'INTERACTION'
  | 'JOURNEY';

export interface UxFinding {
  severity: UxSeverity;
  category: UxCategory;
  /** The screen or component this is about, in product terms. */
  target: string;
  /** The file it was observed in, when the observation came from one. */
  file: string | null;
  issue: string;
  recommendation: string;
  /**
   * True when a deterministic check observed this in the generated source,
   * false when it is a model's judgement. A reader deserves to know which
   * findings are measurements and which are opinions.
   */
  observed: boolean;
}

export interface UxReview {
  projectName: string;
  reviewedFiles: number;
  reviewedScreens: number;
  findings: UxFinding[];
  /** Dimensions that were checked and found nothing — evidence of coverage. */
  passed: UxCategory[];
  /** Present when the model pass was unavailable and the review is checks-only. */
  degraded: boolean;
  note: string | null;
}

/** One targeted edit. The `before`/`after` pair is what makes it reviewable. */
export interface UxImprovement {
  file: string;
  category: UxCategory;
  description: string;
  /** The exact fragment replaced, for audit. Truncated for very long matches. */
  before: string;
  after: string;
}

export interface UxImprovementSet {
  improvements: UxImprovement[];
  /**
   * Files rewritten, and files deliberately left alone. A UX pass that
   * touched every file would be a rewrite wearing a review's name.
   */
  filesChanged: string[];
  filesUnchanged: number;
}
