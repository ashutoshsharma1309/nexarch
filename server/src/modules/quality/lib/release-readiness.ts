/**
 * Release readiness — four escalating tiers, each gated on specific,
 * checkable criteria (not just the overall score, though the score
 * factors in). A project is at the highest tier whose full gate it clears.
 */
import type {
  ArchitectureValidationReport,
  EngineeringScore,
  QualityArtifacts,
  QualityReport,
  ReadinessCheck,
  ReadinessTier,
  ReleaseReadiness,
  SecurityValidationReport,
} from '../quality.types.js';

export function determineReleaseReadiness(
  artifacts: QualityArtifacts,
  quality: QualityReport,
  security: SecurityValidationReport,
  architecture: ArchitectureValidationReport,
  score: EngineeringScore,
  testingCoverageEstimatePercent: number,
): ReleaseReadiness {
  const checks: ReadinessCheck[] = [
    {
      name: 'Project has been generated',
      tier: 'development',
      passed: Boolean(artifacts.backend ?? artifacts.frontend),
    },
    {
      name: 'Architecture plan exists',
      tier: 'development',
      passed: Boolean(artifacts.architecture),
    },

    {
      name: 'Test scaffolding generated',
      tier: 'testing',
      passed: testingCoverageEstimatePercent > 0,
    },
    {
      name: 'No critical quality issues',
      tier: 'testing',
      passed: quality.issues.every((i) => i.severity !== 'critical'),
    },
    { name: 'Architecture score at least 60', tier: 'testing', passed: architecture.score >= 60 },

    { name: 'Security score at least 70', tier: 'production', passed: security.score >= 70 },
    {
      name: 'No hardcoded secrets detected',
      tier: 'production',
      passed: security.secretsDetected.length === 0,
    },
    { name: 'Quality score at least 70', tier: 'production', passed: quality.score >= 70 },
    {
      name: 'Deployment infrastructure configured',
      tier: 'production',
      passed: Boolean(artifacts.deploymentConfigured),
    },
    {
      name: 'Documentation package complete',
      tier: 'production',
      passed: Boolean(artifacts.requirements && artifacts.architecture),
    },

    { name: 'Security score at least 85', tier: 'enterprise', passed: security.score >= 85 },
    {
      name: 'Overall engineering score at least 85',
      tier: 'enterprise',
      passed: score.overall >= 85,
    },
    {
      name: 'Zero circular dependencies',
      tier: 'enterprise',
      passed: quality.circularDependencies === 0,
    },
    {
      name: 'Zero critical or high severity quality issues',
      tier: 'enterprise',
      passed: quality.issues.every((i) => i.severity !== 'critical' && i.severity !== 'high'),
    },
  ];

  const tierOrder: ReadinessTier[] = ['development', 'testing', 'production', 'enterprise'];
  let tier: ReadinessTier = 'development';
  for (const candidate of tierOrder) {
    const tierChecks = checks.filter((c) => c.tier === candidate);
    if (tierChecks.every((c) => c.passed)) tier = candidate;
    else break;
  }

  const recommendations = checks.filter((c) => !c.passed).map((c) => `[${c.tier}] ${c.name}`);

  return { tier, checks, recommendations };
}
