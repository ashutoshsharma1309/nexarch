/**
 * Assembles the security-report.json: a 0-100 score computed from
 * outstanding (unresolved) risk, a letter grade, and the recommendation
 * list a reviewer would actually act on — deduplicated, most-severe first.
 */
import type {
  SecurityFinding,
  SecurityReport,
  SecuritySeverity,
} from '../security-engine.types.js';
import type { SecurityModel } from './security-model.js';

const SEVERITY_WEIGHT: Record<SecuritySeverity, number> = {
  critical: 25,
  high: 15,
  medium: 7,
  low: 3,
};

const SEVERITY_ORDER: SecuritySeverity[] = ['critical', 'high', 'medium', 'low'];

function gradeOf(score: number): SecurityReport['grade'] {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

function scoreOf(unresolved: SecurityFinding[]): number {
  const deduction = unresolved.reduce((sum, f) => sum + SEVERITY_WEIGHT[f.severity], 0);
  return Math.max(0, Math.min(100, 100 - deduction));
}

export function buildSecurityReport(
  model: SecurityModel,
  findings: SecurityFinding[],
  endpoints: SecurityReport['endpoints'],
): SecurityReport {
  const unresolved = findings.filter((f) => !f.resolved);
  const resolvedFindings = findings.filter((f) => f.resolved);
  const score = scoreOf(unresolved);

  const summary = {
    critical: unresolved.filter((f) => f.severity === 'critical').length,
    high: unresolved.filter((f) => f.severity === 'high').length,
    medium: unresolved.filter((f) => f.severity === 'medium').length,
    low: unresolved.filter((f) => f.severity === 'low').length,
    resolved: resolvedFindings.length,
  };

  const recommendations = [
    ...new Set(
      unresolved
        .slice()
        .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity))
        .map((f) => f.recommendation),
    ),
  ];

  return {
    meta: {
      projectName: model.projectName,
      projectType: model.projectType,
      generatedAt: new Date().toISOString(),
      generator: 'NexArch Security Engine',
    },
    overallScore: score,
    grade: gradeOf(score),
    summary,
    findings,
    resolvedFindings,
    recommendations,
    endpoints,
  };
}
