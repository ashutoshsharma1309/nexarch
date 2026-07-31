/**
 * Engineering scores with receipts. Every score starts from the planner's
 * own 1-10 NFR assessment (scaled to /100) and is then adjusted by
 * verifiable structural facts — table counts, index coverage, security
 * plan contents — with a reasoning line per adjustment. When a Phase 12
 * quality report is supplied, the overall score averages it in rather than
 * recomputing what that engine already measured.
 */
import type { ArchitecturePlan } from '../../../shared/types/architecture.js';
import type { DatabaseDesign } from '../../../shared/types/design.js';
import type { InsightScore, InsightsArtifacts, InsightsScores } from '../insights.types.js';

function clamp(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function toGrade(score: number): InsightScore['grade'] {
  if (score >= 95) return 'A+';
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

function buildScore(base: number, adjustments: { delta: number; reason: string }[]): InsightScore {
  const reasoning: string[] = [];
  let score = base;
  for (const adjustment of adjustments) {
    score += adjustment.delta;
    const sign = adjustment.delta >= 0 ? '+' : '';
    reasoning.push(`${sign}${String(adjustment.delta)}: ${adjustment.reason}`);
  }
  const final = clamp(score);
  return { score: final, grade: toGrade(final), reasoning };
}

function scoreMaintainability(plan: ArchitecturePlan, design: DatabaseDesign): InsightScore {
  const base = plan.nonFunctional.maintainability.score * 10;
  const adjustments: { delta: number; reason: string }[] = [
    {
      delta: 0,
      reason: `planner NFR baseline ${String(plan.nonFunctional.maintainability.score)}/10`,
    },
  ];

  const modules = plan.apiModules.length;
  if (modules > 0 && modules <= 12) {
    adjustments.push({
      delta: 5,
      reason: `${String(modules)} feature modules — small enough to hold in one head`,
    });
  } else if (modules > 12) {
    adjustments.push({
      delta: -5,
      reason: `${String(modules)} feature modules — onboarding cost grows past ~12`,
    });
  }

  const endpoints = plan.apiModules.reduce((sum, m) => sum + m.endpoints.length, 0);
  const perModule = modules > 0 ? endpoints / modules : 0;
  if (perModule > 0 && perModule <= 8) {
    adjustments.push({
      delta: 3,
      reason: `~${String(Math.round(perModule))} endpoints per module — cohesive module boundaries`,
    });
  } else if (perModule > 8) {
    adjustments.push({
      delta: -3,
      reason: `~${String(Math.round(perModule))} endpoints per module — some modules are doing several jobs`,
    });
  }

  if (design.enums.length > 0) {
    adjustments.push({
      delta: 2,
      reason: `${String(design.enums.length)} enum(s) — states are typed, not stringly`,
    });
  }

  return buildScore(base, adjustments);
}

function scoreSecurity(plan: ArchitecturePlan): InsightScore {
  const base = plan.nonFunctional.security.score * 10;
  const adjustments: { delta: number; reason: string }[] = [
    { delta: 0, reason: `planner NFR baseline ${String(plan.nonFunctional.security.score)}/10` },
  ];

  const security = plan.security;
  if (security.authentication.length > 0) {
    adjustments.push({
      delta: 3,
      reason: `authentication plan present (${security.sessionStrategy})`,
    });
  }
  if (security.rateLimiting.length > 0) {
    adjustments.push({ delta: 2, reason: 'rate limiting planned on the API surface' });
  }
  if (security.headers.length >= 3) {
    adjustments.push({
      delta: 2,
      reason: `${String(security.headers.length)} hardened response headers planned`,
    });
  }
  if (security.passwordPolicy.length === 0) {
    adjustments.push({ delta: -5, reason: 'no password policy recorded in the security plan' });
  }

  const guardedShare =
    plan.apiModules.flatMap((m) => m.endpoints).filter((e) => e.auth).length /
    Math.max(
      1,
      plan.apiModules.reduce((sum, m) => sum + m.endpoints.length, 0),
    );
  if (guardedShare >= 0.5) {
    adjustments.push({
      delta: 3,
      reason: `${String(Math.round(guardedShare * 100))}% of endpoints require authentication`,
    });
  }

  return buildScore(base, adjustments);
}

function scoreScalability(plan: ArchitecturePlan, design: DatabaseDesign): InsightScore {
  const base = plan.nonFunctional.scalability.score * 10;
  const adjustments: { delta: number; reason: string }[] = [
    { delta: 0, reason: `planner NFR baseline ${String(plan.nonFunctional.scalability.score)}/10` },
  ];

  const indexedTables = design.tables.filter((t) => t.indexes.length > 0).length;
  if (design.tables.length > 0 && indexedTables / design.tables.length >= 0.5) {
    adjustments.push({
      delta: 4,
      reason: `${String(indexedTables)}/${String(design.tables.length)} tables carry explicit indexes`,
    });
  }
  if (design.optimization.cachingCandidates.length > 0) {
    adjustments.push({
      delta: 2,
      reason: `${String(design.optimization.cachingCandidates.length)} caching candidate(s) already identified`,
    });
  }
  if (plan.futureScalability.length > 0) {
    adjustments.push({
      delta: 3,
      reason: `${String(plan.futureScalability.length)} scaling recommendation(s) with explicit triggers — growth is planned, not hoped for`,
    });
  }

  return buildScore(base, adjustments);
}

export function buildScores(artifacts: InsightsArtifacts): InsightsScores {
  const maintainability = scoreMaintainability(artifacts.architecture, artifacts.databaseDesign);
  const security = scoreSecurity(artifacts.architecture);
  const scalability = scoreScalability(artifacts.architecture, artifacts.databaseDesign);

  const parts = [maintainability.score, security.score, scalability.score];
  const reasoning = [
    `mean of maintainability ${String(maintainability.score)}, security ${String(security.score)}, scalability ${String(scalability.score)}`,
  ];
  if (artifacts.quality) {
    parts.push(artifacts.quality.overallScore);
    reasoning.push(
      `blended with the Quality Engine's measured score ${String(artifacts.quality.overallScore)} (${artifacts.quality.grade})`,
    );
  }
  const overallScore = clamp(parts.reduce((sum, p) => sum + p, 0) / parts.length);

  return {
    maintainability,
    security,
    scalability,
    overall: { score: overallScore, grade: toGrade(overallScore), reasoning },
  };
}
