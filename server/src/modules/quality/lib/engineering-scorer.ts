/**
 * Combines every prior analysis into one engineering score. Each category
 * score traces back to a real computed number from this request (quality,
 * security, performance, architecture reports) or a documented heuristic
 * (scalability, documentation completeness, deployment readiness,
 * developer experience) — never a fixed or random value.
 */
import type {
  ArchitectureValidationReport,
  CategoryScore,
  EngineeringGrade,
  EngineeringScore,
  PerformanceReport,
  QualityArtifacts,
  QualityReport,
  ScoreCategory,
  SecurityValidationReport,
} from '../quality.types.js';

function gradeFor(score: number): EngineeringGrade {
  if (score >= 95) return 'A+';
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

function scalabilityScore(artifacts: QualityArtifacts): { score: number; notes: string[] } {
  const graph = artifacts.dependencyGraph?.stats;
  if (!graph) return { score: 50, notes: ['Build the dependency graph to assess scalability.'] };

  let score = 100;
  const notes: string[] = [];
  if (graph.circularDependencyCount > 0) {
    score -= 30;
    notes.push(
      'Circular dependencies make independent horizontal scaling of affected modules harder.',
    );
  }
  if (graph.averageDependencyDepth > 6) {
    score -= 15;
    notes.push('Deep dependency chains increase the blast radius of any single change.');
  }
  if (score === 100)
    notes.push('Dependency graph is shallow and acyclic — no structural scaling concerns.');
  return { score: Math.max(0, score), notes };
}

function documentationScore(artifacts: QualityArtifacts): { score: number; notes: string[] } {
  const inputs = [
    Boolean(artifacts.requirements),
    Boolean(artifacts.architecture),
    Boolean(artifacts.databaseDesign),
    Boolean(artifacts.security),
    Boolean(artifacts.backend),
    Boolean(artifacts.frontend),
  ];
  const present = inputs.filter(Boolean).length;
  const score = Math.round((present / inputs.length) * 100);
  const notes =
    present === inputs.length
      ? ['All 10 documents were generated with real content from every pipeline stage.']
      : [
          `${inputs.length - present} pipeline stage(s) missing — the corresponding docs will note "not generated yet".`,
        ];
  return { score, notes };
}

function deploymentScore(artifacts: QualityArtifacts): { score: number; notes: string[] } {
  if (artifacts.deploymentConfigured) {
    return { score: 100, notes: ['Deployment infrastructure has been generated for a target.'] };
  }
  return {
    score: 40,
    notes: ['No deployment target configured yet — visit the Deployment Dashboard.'],
  };
}

function developerExperienceScore(
  quality: QualityReport,
  architecture: ArchitectureValidationReport,
  testingCoverageEstimatePercent: number,
): { score: number; notes: string[] } {
  const score = Math.round(
    (quality.score + architecture.score + testingCoverageEstimatePercent) / 3,
  );
  const notes = [
    `Averages code quality (${quality.score}), architecture conventions (${architecture.score}), and test coverage (${testingCoverageEstimatePercent}%).`,
  ];
  return { score, notes };
}

export function computeEngineeringScore(
  artifacts: QualityArtifacts,
  quality: QualityReport,
  performance: PerformanceReport,
  security: SecurityValidationReport,
  architecture: ArchitectureValidationReport,
  testingCoverageEstimatePercent: number,
): EngineeringScore {
  const scalability = scalabilityScore(artifacts);
  const documentation = documentationScore(artifacts);
  const deployment = deploymentScore(artifacts);
  const developerExperience = developerExperienceScore(
    quality,
    architecture,
    testingCoverageEstimatePercent,
  );

  const categoryValues: Record<ScoreCategory, { score: number; notes: string[] }> = {
    architecture: { score: architecture.score, notes: architecture.violations },
    security: {
      score: security.score,
      notes: security.checks.filter((c) => !c.passed).map((c) => c.detail),
    },
    performance: { score: performance.score, notes: performance.recommendations },
    maintainability: {
      score: quality.score,
      notes: quality.issues.slice(0, 3).map((i) => i.message),
    },
    scalability,
    testing: {
      score: testingCoverageEstimatePercent,
      notes: [
        `${testingCoverageEstimatePercent}% of modules/pages have generated test scaffolding.`,
      ],
    },
    documentation,
    deployment,
    developerExperience,
  };

  const categories: CategoryScore[] = (Object.keys(categoryValues) as ScoreCategory[]).map(
    (category) => ({
      category,
      score: categoryValues[category].score,
      grade: gradeFor(categoryValues[category].score),
      notes: categoryValues[category].notes.slice(0, 3),
    }),
  );

  const overall = Math.round(categories.reduce((sum, c) => sum + c.score, 0) / categories.length);

  const weakest = [...categories].sort((a, b) => a.score - b.score).slice(0, 3);
  const recommendations = weakest
    .filter((c) => c.score < 90)
    .map((c) => `${c.category} (${c.score}/100): ${c.notes[0] ?? 'review this category.'}`);
  if (recommendations.length === 0)
    recommendations.push('Every category scores 90+ — this project is in strong shape.');

  return {
    overall,
    grade: gradeFor(overall),
    categories,
    recommendations,
    generatedAt: new Date().toISOString(),
  };
}
