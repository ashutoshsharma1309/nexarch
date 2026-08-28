/**
 * The repair loop's vocabulary.
 *
 * Everything here exists to keep autonomous modification *accountable*:
 * a repair is a plan that named its files before any file changed, a
 * changeset that recorded before and after, a validation that ran, and a
 * verdict that follows from the validation — never from the model's
 * confidence in its own patch. The strict principle at the bottom of the
 * Phase 11 spec (detect → understand → plan → patch → validate → accept
 * or roll back) is the shape of these types.
 */

/** Whether the machine may touch a finding at all. Decided by rules, not a model. */
export type RepairEligibility = 'AUTO_REPAIRABLE' | 'REQUIRES_REVIEW' | 'NOT_REPAIRABLE';

export interface EligibilityDecision {
  eligibility: RepairEligibility;
  /** The rule that decided — shown to a person, so it must read as one. */
  reason: string;
}

/* ── Root cause (Step 5) ───────────────────────────────────────────────── */

export interface RootCauseAnalysis {
  findingId: string;
  rootCause: string;
  affectedNodes: string[];
  affectedArtifacts: string[];
  /** Project-relative, area-prefixed: `frontend/src/…`. */
  affectedFiles: string[];
  /** 0–1. Below the engine's threshold, no repair is attempted. */
  confidence: number;
  repairability: RepairEligibility;
  /** How the cause was determined: parsed evidence, or reasoned. */
  method: 'deterministic' | 'model';
}

/* ── Plan (Step 6) ─────────────────────────────────────────────────────── */

export type RepairCheckKind = 'TYPECHECK' | 'CONTRACT_AUDIT' | 'MANIFEST_AUDIT';

export interface RepairPlan {
  findingId: string;
  strategy: string;
  intent: string;
  /** The only files the repair may touch. Enforced, not advisory. */
  authorizedFiles: string[];
  targetNodes: string[];
  /** Checks that must pass for the repair to be accepted. */
  validation: RepairCheckKind[];
  risk: 'LOW' | 'MEDIUM' | 'HIGH';
  rollback: string;
}

/* ── Changeset (Step 11) ───────────────────────────────────────────────── */

export interface FileEdit {
  file: string;
  /** Must occur exactly once in the file — ambiguity fails the repair. */
  find: string;
  replace: string;
}

export interface DiffHunk {
  /** 1-based line in the previous version where the hunk starts. */
  line: number;
  removed: string[];
  added: string[];
}

export interface FileChangeRecord {
  file: string;
  addedLines: number;
  removedLines: number;
  hunks: DiffHunk[];
  /** Artifact versions this change moved between. */
  previousVersion: number;
  newVersion: number;
}

export interface RepairChangeset {
  repairId: string;
  findingId: string;
  agentId: string;
  reason: string;
  files: FileChangeRecord[];
  createdAt: string;
  rolledBack: boolean;
}

/* ── Validation and attempts (Steps 13–18) ─────────────────────────────── */

export interface RepairCheckOutcome {
  kind: RepairCheckKind;
  status: 'PASS' | 'FAIL';
  evidence: string;
}

export interface RepairAttempt {
  attempt: number;
  strategy: string;
  applied: boolean;
  checks: RepairCheckOutcome[];
  /** Checks that passed at baseline and failed after the patch. */
  regressions: string[];
  outcome: 'ACCEPTED' | 'VALIDATION_FAILED' | 'REGRESSION' | 'PATCH_FAILED';
  error: string | null;
  durationMs: number;
}

/* ── History (Step 22) ─────────────────────────────────────────────────── */

export interface RepairRecord {
  id: string;
  projectId: string;
  findingId: string;
  findingTitle: string;
  severity: string;
  agentId: string;
  eligibility: EligibilityDecision;
  rootCause: RootCauseAnalysis | null;
  plan: RepairPlan | null;
  attempts: RepairAttempt[];
  changeset: RepairChangeset | null;
  result:
    | 'FIXED'
    | 'REJECTED'
    | 'REQUIRES_REVIEW'
    | 'NOT_REPAIRABLE'
    | 'REGRESSION'
    | 'REPAIR_LOOP'
    | 'SKIPPED';
  rolledBack: boolean;
  tokens: { input: number; output: number; context: number };
  durationMs: number;
  createdAt: string;
}

/* ── Session, budget and final state (Steps 36–38) ─────────────────────── */

export interface RepairConfig {
  maxAttemptsPerFinding: number;
  maxRepairsPerRun: number;
  maxDurationMs: number;
  maxTokens: number;
  /** Root-cause confidence below which no repair is attempted. */
  minConfidence: number;
}

export const DEFAULT_REPAIR_CONFIG: RepairConfig = {
  maxAttemptsPerFinding: 2,
  maxRepairsPerRun: 10,
  maxDurationMs: 10 * 60_000,
  maxTokens: 50_000,
  minConfidence: 0.6,
};

export type FinalQualityState =
  | 'VALIDATION_PENDING'
  | 'REPAIRING'
  | 'PASSED'
  | 'PASSED_WITH_WARNINGS'
  | 'REQUIRES_REVIEW'
  | 'FAILED'
  | 'REPAIR_BUDGET_EXCEEDED'
  | 'REPAIR_LOOP_DETECTED';

export interface RepairSessionState {
  id: string;
  projectId: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  finalState: FinalQualityState;
  /** Why the loop stopped — the rule, in words. */
  stopReason: string;
  counts: {
    considered: number;
    autoRepairable: number;
    fixed: number;
    rejected: number;
    requiresReview: number;
    notRepairable: number;
    rolledBack: number;
    repairLoops: number;
  };
  tokens: { input: number; output: number; context: number };
  startedAt: string;
  completedAt: string | null;
  /** The finding currently in surgery, for the dashboard. */
  activeFindingId: string | null;
}
