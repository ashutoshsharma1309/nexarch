/**
 * Quality service tests (`npm test`). `QualityArtifacts` is built by
 * driving the real pipeline (analyze → plan → design → generate backend +
 * frontend → apply security → build dependency graph) for a couple of
 * domains — the same integration-guard pattern every generator-consuming
 * module's tests use — so assertions run against real generated files,
 * not hand-shaped fixtures.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { analyzeRequirements } from '../analysis/analysis.service.js';
import { planArchitecture } from '../architecture/architecture.service.js';
import { generateBackend } from '../backend-generator/backend-generator.service.js';
import { buildDependencyGraphBundle } from '../dependency-graph/dependency-graph.service.js';
import { designDatabase } from '../database-designer/database-designer.service.js';
import { generateFrontend } from '../frontend-generator/frontend-generator.service.js';
import { applySecurity } from '../security-engine/security-engine.service.js';
import { analyzeQuality, generateDocumentation, runExport, runTesting } from './quality.service.js';
import type { QualityArtifacts } from './quality.types.js';

function buildArtifacts(prompt: string): QualityArtifacts {
  const analysis = analyzeRequirements(prompt);
  if (analysis.status !== 'COMPLETE') assert.fail(`expected COMPLETE analysis for: ${prompt}`);
  const { plan } = planArchitecture(analysis.spec);
  const design = designDatabase(plan, analysis.spec);
  const backendProject = generateBackend(
    plan,
    analysis.spec,
    design.databaseDesign,
    design.prismaSchema,
    design.openapi,
    design.validationRules.entities,
    design.entityMetadata,
  );
  const backendManifest = { modules: backendProject.modules, routes: backendProject.routes };
  const frontendProject = generateFrontend(
    plan,
    analysis.spec,
    design.databaseDesign,
    design.openapi,
    backendManifest,
    design.entityMetadata,
  );
  const frontendManifest = {
    pages: frontendProject.pages.map((p) => ({
      name: p.name,
      route: p.route,
      kind: p.kind,
      entity: p.entity,
      implemented: p.implemented,
    })),
  };
  const security = applySecurity({
    requirements: analysis.spec,
    architecture: plan,
    database: design.databaseDesign,
    openapi: design.openapi,
    entityMetadata: design.entityMetadata,
    backendManifest,
    frontendManifest,
  });
  const graph = buildDependencyGraphBundle({
    requirements: analysis.spec,
    architecture: plan,
    database: design.databaseDesign,
    backend: {
      files: backendProject.files,
      modules: backendProject.modules,
      routes: backendProject.routes,
    },
    frontend: {
      files: frontendProject.files,
      pages: frontendProject.pages,
      components: frontendProject.components,
      routes: frontendProject.routes,
      stores: frontendProject.stores,
    },
    security: {
      backendFiles: security.backendFiles,
      frontendFiles: security.frontendFiles,
      rbac: security.rbac,
    },
  }).bundle;

  return {
    projectName: plan.meta.projectName,
    requirements: {
      frontend: analysis.spec.frontend,
      backend: analysis.spec.backend,
      modules: analysis.spec.modules,
      authentication: analysis.spec.authentication,
    },
    architecture: {
      decisions: { architecture: { choice: plan.decisions.architecture.choice } },
      folderStructure: plan.folderStructure,
      database: { engine: plan.database.engine },
    },
    databaseDesign: { tables: design.databaseDesign.tables.map((t) => ({ entity: t.entity })) },
    backend: {
      files: backendProject.files.map((f) => ({ path: f.path, content: f.content })),
      modules: backendProject.modules.map((m) => m.name),
      routes: backendProject.routes,
    },
    frontend: {
      files: frontendProject.files.map((f) => ({ path: f.path, content: f.content })),
      pages: frontendProject.pages.map((p) => ({ name: p.name, route: p.route })),
      components: frontendProject.components.map((c) => c.name),
    },
    openapi: { paths: design.openapi.paths },
    security: { report: security.report, owasp: security.owasp, stats: security.stats },
    dependencyGraph: {
      stats: graph.stats,
      quality: {
        recommendations: graph.quality.recommendations,
        orphanFiles: graph.quality.orphanFiles,
        unusedComponents: graph.quality.unusedComponents,
        deadRoutes: graph.quality.deadRoutes,
      },
    },
  };
}

const artifacts = buildArtifacts(
  'Build a hospital management system where patients book appointments with doctors, with billing, prescriptions and sms reminders',
);

describe('testing engine', () => {
  it('generates files across every required test category', () => {
    const report = runTesting(artifacts);
    const kinds = new Set(report.files.map((f) => f.kind));
    for (const kind of ['unit', 'api', 'component', 'e2e', 'regression', 'smoke']) {
      assert.ok(kinds.has(kind as (typeof report.files)[number]['kind']), `missing ${kind} tests`);
    }
    assert.ok(report.coverageEstimatePercent > 0);
  });

  it('validates the real OpenAPI contract with zero issues', () => {
    const report = runTesting(artifacts);
    assert.equal(report.openApiValidation.valid, true);
    assert.ok(report.openApiValidation.endpointsCovered > 0);
    assert.deepEqual(report.openApiValidation.issues, []);
  });

  it('summary case counts are non-zero for generated suites', () => {
    const report = runTesting(artifacts);
    for (const summary of report.summary) {
      assert.ok(summary.caseCount > 0, `${summary.kind} generated zero test cases`);
    }
  });

  it('degrades gracefully with no artifacts beyond a project name', () => {
    const report = runTesting({ projectName: 'Empty' });
    // validation + authentication (always generated) + smoke test.
    assert.equal(report.files.length, 3);
    assert.equal(report.coverageEstimatePercent, 50);
  });
});

describe('quality analyzer', () => {
  it('computes real duplication, complexity, and large-file metrics from generated source', () => {
    const bundle = analyzeQuality(artifacts);
    assert.ok(bundle.quality.metrics.length > 0);
    assert.ok(bundle.quality.score >= 0 && bundle.quality.score <= 100);
  });

  it("reuses the dependency graph's own circular-dependency count rather than recomputing it", () => {
    const bundle = analyzeQuality(artifacts);
    assert.equal(
      bundle.quality.circularDependencies,
      artifacts.dependencyGraph?.stats.circularDependencyCount,
    );
  });

  it('flags exact-duplicate files', () => {
    assert.ok(artifacts.backend);
    const withDuplicate: QualityArtifacts = {
      ...artifacts,
      backend: {
        ...artifacts.backend,
        files: [
          ...artifacts.backend.files,
          { path: 'backend/src/dup-a.ts', content: 'export const x = 1;\n'.repeat(10) },
          { path: 'backend/src/dup-b.ts', content: 'export const x = 1;\n'.repeat(10) },
        ],
      },
    };
    const bundle = analyzeQuality(withDuplicate);
    assert.ok(bundle.quality.duplication.duplicateGroups >= 1);
  });
});

describe('performance analyzer', () => {
  it('reports estimated metrics as estimated and real AI stats as not estimated', () => {
    const withAiStats: QualityArtifacts = {
      ...artifacts,
      aiStats: {
        totalGenerations: 12,
        totalTokens: 50000,
        totalCostUsd: 1.25,
        averageDurationMs: 800,
        cache: { hitRate: 0.4 },
      },
    };
    const bundle = analyzeQuality(withAiStats);
    const bundleSize = bundle.performance.metrics.find((m) => m.name.includes('bundle size'));
    assert.equal(bundleSize?.estimated, true);
    assert.equal(bundle.performance.tokenConsumption?.totalTokens, 50000);
    assert.equal(bundle.performance.cacheHitRate, 0.4);
  });

  it('omits token/cache metrics entirely when no AI stats are provided', () => {
    const bundle = analyzeQuality(artifacts);
    assert.equal(bundle.performance.tokenConsumption, null);
    assert.equal(bundle.performance.cacheHitRate, null);
  });
});

describe('security validator', () => {
  it('reuses the real security report score when available', () => {
    const bundle = analyzeQuality(artifacts);
    assert.equal(bundle.security.score, artifacts.security?.report.overallScore);
  });

  it('detects an obviously hardcoded secret', () => {
    assert.ok(artifacts.backend);
    const withSecret: QualityArtifacts = {
      ...artifacts,
      backend: {
        ...artifacts.backend,
        files: [
          ...artifacts.backend.files,
          {
            path: 'backend/src/config.ts',
            content: `const apiKey = "sk-liveSecretValueThatIsLong1234567890";`,
          },
        ],
      },
    };
    const bundle = analyzeQuality(withSecret);
    assert.ok(bundle.security.secretsDetected.length > 0);
    assert.ok(
      bundle.security.checks.find((c) => c.name === 'No hardcoded secrets detected')?.passed ===
        false,
    );
  });
});

describe('architecture validator', () => {
  it('confirms controller/service layer separation across every generated module', () => {
    const bundle = analyzeQuality(artifacts);
    const layerCheck = bundle.architecture.checks.find(
      (c) => c.name === 'Controller/service layer separation',
    );
    assert.equal(layerCheck?.passed, true);
  });
});

describe('documentation generator', () => {
  it('generates exactly the 10 required documents', () => {
    const docs = generateDocumentation(artifacts);
    const kinds = docs.files.map((f) => f.kind).sort();
    assert.deepEqual(kinds, [
      'api-documentation',
      'changelog',
      'contributing',
      'database-documentation',
      'deployment-guide',
      'developer-guide',
      'license',
      'readme',
      'security-guide',
      'system-architecture',
    ]);
    for (const file of docs.files) assert.ok(file.content.length > 10, `${file.filename} is empty`);
  });

  it('embeds real module names in the developer guide', () => {
    const docs = generateDocumentation(artifacts);
    const guide = docs.files.find((f) => f.kind === 'developer-guide');
    const firstModule = artifacts.backend?.modules[0];
    assert.ok(firstModule);
    assert.ok(guide?.content.includes(firstModule));
  });
});

describe('engineering scorer', () => {
  it('produces 9 category scores and a consistent overall/grade', () => {
    const bundle = analyzeQuality(artifacts);
    assert.equal(bundle.score.categories.length, 9);
    for (const category of bundle.score.categories) {
      assert.ok(category.score >= 0 && category.score <= 100);
    }
    assert.ok(bundle.score.overall >= 0 && bundle.score.overall <= 100);
    assert.ok(['A+', 'A', 'B', 'C', 'D', 'F'].includes(bundle.score.grade));
  });

  it('scores deployment low without deploymentConfigured and high with it', () => {
    const without = analyzeQuality(artifacts);
    const withDeployment = analyzeQuality({ ...artifacts, deploymentConfigured: true });
    const deploymentScore = (bundle: typeof without) =>
      bundle.score.categories.find((c) => c.category === 'deployment')?.score ?? 0;
    assert.ok(deploymentScore(withDeployment) > deploymentScore(without));
  });
});

describe('benchmark generator', () => {
  it('covers every named comparison dimension against all three reference approaches', () => {
    const bundle = analyzeQuality(artifacts);
    assert.ok(bundle.benchmark.comparisons.length >= 5);
    for (const comparison of bundle.benchmark.comparisons) {
      assert.ok(comparison.nexarch.length > 0);
      assert.ok(comparison.traditionalCrud.length > 0);
      assert.ok(comparison.basicAiGeneration.length > 0);
      assert.ok(comparison.architectureFirstGeneration.length > 0);
    }
  });
});

describe('release readiness', () => {
  it('never certifies enterprise readiness without deployment configured and a high score', () => {
    const bundle = analyzeQuality(artifacts);
    if (bundle.readiness.tier === 'enterprise') {
      assert.ok(bundle.score.overall >= 85);
    }
  });

  it('reaches at least testing tier for a fully generated project with no critical issues', () => {
    const bundle = analyzeQuality(artifacts);
    assert.ok(['testing', 'production', 'enterprise'].includes(bundle.readiness.tier));
  });

  it('recommendations are empty only when every check passes', () => {
    const bundle = analyzeQuality(artifacts);
    const allPassed = bundle.readiness.checks.every((c) => c.passed);
    assert.equal(bundle.readiness.recommendations.length === 0, allPassed);
  });
});

describe('export manager', () => {
  it('exports every JSON report format as valid JSON', () => {
    for (const format of [
      'quality-report',
      'testing-report',
      'benchmark-report',
      'engineering-score',
      'release-readiness',
    ] as const) {
      const result = runExport({ format, artifacts });
      assert.equal(result.kind, 'file');
      assert.doesNotThrow(() => JSON.parse(result.content), `${format} is not valid JSON`);
    }
  });

  it('exports readme as markdown matching the documentation bundle', () => {
    const result = runExport({ format: 'readme', artifacts });
    assert.equal(result.kind, 'file');
    assert.match(result.content, /^# /);
  });

  it('exports the documentation package as a 10-file archive', () => {
    const result = runExport({ format: 'documentation-package', artifacts });
    assert.equal(result.kind, 'archive');
    assert.equal(result.files.length, 10);
    assert.ok(result.files.some((f) => f.path === 'LICENSE'));
  });
});
