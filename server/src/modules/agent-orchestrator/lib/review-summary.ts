/**
 * The review, counted.
 *
 * Everything here is arithmetic over findings that already exist. There is
 * no model call, no weighting anyone has to take on faith, and no number
 * that cannot be recomputed by hand from the finding list — which is the
 * whole point of Step 23. A score a reader cannot reproduce is a score
 * they have to trust, and a review that asks to be trusted rather than
 * checked is worth very little.
 *
 * The penalties below are stated as constants and returned in the
 * breakdown, so the score always ships with its own derivation.
 *
 * What this deliberately does not do is call anything "production ready".
 * A project with no findings has no findings; that is a fact about what
 * three reviewers looked for, not a claim about whether it is safe to
 * deploy. The score is a summary of this review, not a verdict on the
 * software.
 */
import type { AgentFinding, FindingType } from '../../../shared/contracts/index.js';
import type { FindingRecord } from './finding-store.js';

export type Severity = AgentFinding['severity'];

export const SEVERITIES: readonly Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];

/** Points deducted per finding, by severity. Stated, not hidden. */
export const PENALTY: Record<Severity, number> = {
  CRITICAL: 25,
  HIGH: 10,
  MEDIUM: 4,
  LOW: 1,
  INFO: 0,
};

export type SeverityCounts = Record<Severity, number>;

function emptyCounts(): SeverityCounts {
  return { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 };
}

function countBySeverity(findings: readonly FindingRecord[]): SeverityCounts {
  const counts = emptyCounts();
  for (const finding of findings) counts[finding.severity] += 1;
  return counts;
}

export interface SectionSummary {
  type: FindingType;
  total: number;
  counts: SeverityCounts;
  /** Findings this review saw for the first time. */
  newSinceLastReview: number;
}

export interface ScoreBreakdown {
  score: number;
  /** Every deduction, so the arithmetic is checkable. */
  deductions: { severity: Severity; count: number; penaltyEach: number; total: number }[];
  totalDeducted: number;
  /**
   * What the number does and does not mean. Carried with the score so it
   * cannot be displayed without it.
   */
  basis: string;
}

export interface ReviewSummary {
  reviewVersion: number;
  generatedAt: string;
  sections: SectionSummary[];
  totals: {
    findings: number;
    counts: SeverityCounts;
    newSinceLastReview: number;
  };
  score: ScoreBreakdown;
  /** Agents that ran, and whether each finished. Drives PARTIAL_REVIEW. */
  agents: {
    agentId: string;
    status: 'COMPLETED' | 'FAILED';
    findings: number;
    error: string | null;
  }[];
  status: 'COMPLETE' | 'PARTIAL_REVIEW' | 'FAILED';
  /** Named so a reader knows what was *not* checked, not only what was. */
  notes: string[];
}

const REVIEW_TYPES: readonly FindingType[] = ['SECURITY', 'DEPENDENCY', 'CODE_QUALITY'];

/**
 * Only findings marked FALSE_POSITIVE are excluded from the score.
 *
 * An ACKNOWLEDGED finding still counts: someone deciding to live with a
 * problem does not make the problem go away, and a score that improved
 * when a person clicked "acknowledge" would be measuring the clicking.
 */
function scoreable(findings: readonly FindingRecord[]): FindingRecord[] {
  return findings.filter((finding) => finding.status !== 'FALSE_POSITIVE');
}

export function computeScore(findings: readonly FindingRecord[]): ScoreBreakdown {
  const counts = countBySeverity(scoreable(findings));

  const deductions = SEVERITIES.filter((severity) => counts[severity] > 0).map((severity) => ({
    severity,
    count: counts[severity],
    penaltyEach: PENALTY[severity],
    total: counts[severity] * PENALTY[severity],
  }));

  const totalDeducted = deductions.reduce((sum, entry) => sum + entry.total, 0);

  return {
    score: Math.max(0, 100 - totalDeducted),
    deductions,
    totalDeducted,
    basis:
      'Starts at 100 and deducts a fixed amount per open finding: 25 critical, 10 high, 4 medium, 1 low, 0 info. It summarizes what these three reviewers looked for and found — it is not a judgement that the project is ready to deploy.',
  };
}

export interface SummaryInput {
  reviewVersion: number;
  findings: readonly FindingRecord[];
  agents: ReviewSummary['agents'];
  notes: string[];
  generatedAt: string;
}

export function summarizeReview(input: SummaryInput): ReviewSummary {
  const sections = REVIEW_TYPES.map((type): SectionSummary => {
    const forType = input.findings.filter((finding) => finding.type === type);
    return {
      type,
      total: forType.length,
      counts: countBySeverity(forType),
      newSinceLastReview: forType.filter(
        (finding) => finding.firstSeenReview === input.reviewVersion,
      ).length,
    };
  });

  const failed = input.agents.filter((agent) => agent.status === 'FAILED');
  const status: ReviewSummary['status'] =
    failed.length === 0
      ? 'COMPLETE'
      : failed.length === input.agents.length
        ? 'FAILED'
        : 'PARTIAL_REVIEW';

  const notes = [...input.notes];
  for (const agent of failed) {
    notes.push(`${agent.agentId} did not complete: ${agent.error ?? 'unknown error'}.`);
  }

  return {
    reviewVersion: input.reviewVersion,
    generatedAt: input.generatedAt,
    sections,
    totals: {
      findings: input.findings.length,
      counts: countBySeverity(input.findings),
      newSinceLastReview: input.findings.filter(
        (finding) => finding.firstSeenReview === input.reviewVersion,
      ).length,
    },
    score: computeScore(input.findings),
    agents: input.agents,
    status,
    notes,
  };
}

/** One line per section, for a log or an agent summary. */
export function describeReview(summary: ReviewSummary): string {
  const parts = summary.sections
    .filter((section) => section.total > 0)
    .map((section) => `${section.type.toLowerCase().replace('_', ' ')} ${String(section.total)}`);
  const label = parts.length > 0 ? parts.join(' · ') : 'no findings';
  return `${label} · score ${String(summary.score.score)}/100`;
}
