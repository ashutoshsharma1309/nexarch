/**
 * Editing a project that already exists, rather than generating a new one.
 *
 * The distinction the whole module turns on: a build answers "what should
 * this be?", an edit answers "what should change about what this already
 * is?". Everything here is shaped so the second question stays narrow — the
 * plan names the files it expects to touch before it touches them, the result
 * reports the files that actually changed, and the two are comparable.
 */
import type { AcceptedImage, ImageKind } from './lib/image-input.js';
import type { SiteDesign } from '../frontend-generator/frontend-generator.service.js';
import type { DiffHunk } from '../../shared/types/repair.js';
import type { GraphNodeType, GraphRelationship } from '../../shared/contracts/index.js';
import type { CheckStatus } from '../../shared/types/validation.js';

/** What a model actually saw in a reference image — or why there is nothing. */
export interface VisualReading {
  /** False when no image was sent, or the provider could not read one. */
  available: boolean;
  /** Why it is unavailable, in words a user can act on. Null when available. */
  unavailableReason: string | null;
  layout: string;
  palette: string[];
  typography: string;
  spacing: string;
  components: string[];
  mood: string;
  notes: string;
  /** The model that did the reading, recorded so the claim is checkable. */
  model: string | null;
}

export interface PlannedChange {
  path: string;
  /** Why this file is in the plan — derived from the change, never guessed. */
  reason: string;
}

/** A file this edit is expected to leave exactly as it is. */
export interface PreservedArea {
  label: string;
  fileCount: number;
}

export interface ImpactedByEdit {
  nodeId: string;
  name: string;
  type: GraphNodeType;
  depth: number;
  via: GraphRelationship;
  reason: string;
}

export interface EditImpact {
  /** Files the edit itself rewrites. Direct, not inferred. */
  direct: string[];
  /**
   * What the graph says depends on those files. Every entry is an edge the
   * graph actually holds; nothing here is inferred from names.
   */
  dependents: ImpactedByEdit[];
  /** Tests related to the changed files, where the graph links them. */
  tests: ImpactedByEdit[];
  /** True when the graph had nothing to say — reported, never papered over. */
  graphUnavailable: boolean;
  graphUnavailableReason: string | null;
}

export type EditStatus = 'planned' | 'applied' | 'rejected' | 'failed';

export interface EditPlan {
  id: string;
  projectId: string;
  /** The run this edit starts from — the baseline it will be compared against. */
  basedOnRunId: string;
  instruction: string;
  image: { kind: ImageKind; name: string; bytes: number; width: number; height: number } | null;
  reading: VisualReading;
  summary: string;
  changes: PlannedChange[];
  preserved: PreservedArea[];
  impact: EditImpact;
  /** Anything a reviewer should decide about before applying. */
  risks: string[];
  /** What `apply` will actually run, named in advance. */
  validationPlan: string[];
  /** The proposed design, already validated and clamped. */
  design: SiteDesign;
  status: EditStatus;
  createdAt: string;
}

export interface ChangedFile {
  path: string;
  addedLines: number;
  removedLines: number;
  hunks: DiffHunk[];
}

export interface EditValidation {
  /**
   * Every check that ran, in the runtime validator's own vocabulary.
   * `SKIPPED` stays distinct from `PASS` on purpose: a project with no lint
   * script did not pass lint, it never ran it.
   */
  checks: { name: string; status: CheckStatus; detail: string }[];
  /** Did the edited application start and answer? */
  startedUp: boolean;
  frontendUrl: string | null;
  backendUrl: string | null;
}

export interface EditResult {
  planId: string;
  projectId: string;
  status: EditStatus;
  /** The run the edit produced, when it was accepted. Null when it was not. */
  runId: string | null;
  changedFiles: ChangedFile[];
  unchangedFileCount: number;
  validation: EditValidation;
  /** Why the edit was accepted or discarded, in one readable line. */
  outcome: string;
  /** True when the edit was discarded and the project still has its old files. */
  rolledBack: boolean;
  completedAt: string;
}

export interface PlanEditInput {
  projectId: string;
  ownerId: string;
  instruction: string;
  image: AcceptedImage | null;
}
