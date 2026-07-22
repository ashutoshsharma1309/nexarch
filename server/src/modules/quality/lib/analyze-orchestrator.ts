/**
 * Runs every analyzer once and assembles the full `EngineeringBundle` —
 * shared by the service (for `POST /quality/analyze` and the cached
 * `GET` endpoints) and the export manager (which needs the same bundle to
 * build `quality-report`/`engineering-score`/`release-readiness` exports
 * without duplicating the orchestration logic).
 */
import { validateArchitecture } from './architecture-validator.js';
import { generateApiTests, validateOpenApi } from './api-test-generator.js';
import { generateBenchmark } from './benchmark-generator.js';
import { generateE2eTests } from './e2e-test-generator.js';
import { computeEngineeringScore } from './engineering-scorer.js';
import { generateFrontendTests } from './frontend-test-generator.js';
import { analyzePerformance } from './performance-analyzer.js';
import { analyzeQuality } from './quality-analyzer.js';
import { determineReleaseReadiness } from './release-readiness.js';
import { validateSecurity } from './security-validator.js';
import { generateUnitTests } from './unit-test-generator.js';
import type {
  EngineeringBundle,
  QualityArtifacts,
  TestFile,
  TestingReport,
} from '../quality.types.js';

export function generateAllTests(artifacts: QualityArtifacts): TestFile[] {
  return [
    ...generateUnitTests(artifacts),
    ...generateApiTests(artifacts),
    ...generateFrontendTests(artifacts),
    ...generateE2eTests(artifacts),
  ];
}

function summarizeTests(files: TestFile[]): TestingReport['summary'] {
  const byKind = new Map<TestFile['kind'], TestFile[]>();
  for (const file of files) {
    const list = byKind.get(file.kind) ?? [];
    list.push(file);
    byKind.set(file.kind, list);
  }
  return Array.from(byKind.entries()).map(([kind, kindFiles]) => ({
    kind,
    fileCount: kindFiles.length,
    caseCount: kindFiles.reduce(
      // Matches node:test's it()/it.each() and Playwright's test() case declarations.
      (sum, file) => sum + (file.content.match(/\b(it|test)(\.each\([^)]*\))?\(/g)?.length ?? 0),
      0,
    ),
  }));
}

function estimateCoverage(artifacts: QualityArtifacts, files: TestFile[]): number {
  const targetable =
    (artifacts.backend?.modules.length ?? 0) +
    (artifacts.frontend?.components.length ?? 0) +
    (artifacts.frontend?.pages.length ?? 0);
  if (targetable === 0) return files.length > 0 ? 50 : 0;
  const covered = files.length > 0 ? Math.min(targetable, files.length * 4) : 0;
  return Math.round((covered / targetable) * 100);
}

export function generateTestingReport(artifacts: QualityArtifacts): TestingReport {
  const files = generateAllTests(artifacts);
  return {
    files,
    summary: summarizeTests(files),
    coverageEstimatePercent: estimateCoverage(artifacts, files),
    openApiValidation: validateOpenApi(artifacts),
  };
}

export function computeEngineeringBundle(artifacts: QualityArtifacts): EngineeringBundle {
  const testing = generateTestingReport(artifacts);
  const quality = analyzeQuality(artifacts);
  const performance = analyzePerformance(artifacts);
  const security = validateSecurity(artifacts);
  const architecture = validateArchitecture(artifacts);
  const score = computeEngineeringScore(
    artifacts,
    quality,
    performance,
    security,
    architecture,
    testing.coverageEstimatePercent,
  );
  const benchmark = generateBenchmark(artifacts, performance, security);
  const readiness = determineReleaseReadiness(
    artifacts,
    quality,
    security,
    architecture,
    score,
    testing.coverageEstimatePercent,
  );

  return {
    meta: {
      projectName: artifacts.projectName,
      generatedAt: new Date().toISOString(),
      generator: 'nexarch-quality-engine@1.0.0',
    },
    quality,
    performance,
    security,
    architecture,
    testingSummary: testing.summary,
    testingCoverageEstimatePercent: testing.coverageEstimatePercent,
    score,
    benchmark,
    readiness,
  };
}
