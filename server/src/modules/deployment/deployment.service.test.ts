/**
 * Deployment service tests (`npm test`). `DeploymentArtifacts` is built by
 * driving the real pipeline (analyze → plan → design → generate backend +
 * frontend) for a couple of domains — the same integration-guard pattern
 * every generator-consuming module's tests use — so these assertions run
 * against real generated Dockerfiles, not hand-shaped fixtures.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { analyzeRequirements } from '../analysis/analysis.service.js';
import { planArchitecture } from '../architecture/architecture.service.js';
import { generateBackend } from '../backend-generator/backend-generator.service.js';
import { designDatabase } from '../database-designer/database-designer.service.js';
import { generateFrontend } from '../frontend-generator/frontend-generator.service.js';
import { AppError } from '../../shared/utils/app-error.js';
import {
  executeDeploy,
  generateDeployment,
  getDeployExecution,
  getHealthPreview,
  getProviders,
  getStatus,
  planDeployExecution,
  runExport,
  SUPPORTED_TARGETS,
} from './deployment.service.js';
import type { DeploymentArtifacts, DeploymentTarget } from './deployment.types.js';

function buildArtifacts(prompt: string): DeploymentArtifacts {
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

  return {
    projectName: plan.meta.projectName,
    architecture: { database: { engine: plan.database.engine } },
    requirements: { frontend: analysis.spec.frontend, backend: analysis.spec.backend },
    backend: { files: backendProject.files.map((f) => ({ path: f.path, content: f.content })) },
    frontend: { files: frontendProject.files.map((f) => ({ path: f.path, content: f.content })) },
  };
}

const artifacts = buildArtifacts(
  'Build a hospital management system where patients book appointments with doctors, with billing, prescriptions and sms reminders',
);

describe('docker bundle', () => {
  it('generates compose files that reference the existing backend/frontend build contexts', () => {
    const bundle = generateDeployment({ target: 'docker-compose', artifacts });
    assert.match(bundle.docker.composeDev.content, /context: \.\/backend/);
    assert.match(bundle.docker.composeDev.content, /context: \.\/frontend/);
    assert.match(bundle.docker.composeDev.content, /4000:4000/);
    assert.match(bundle.docker.composeProd.content, /healthcheck/);
    assert.equal(bundle.docker.dockerignoreBackend.path, 'backend/.dockerignore');
    assert.equal(bundle.docker.dockerignoreFrontend.path, 'frontend/.dockerignore');
  });

  it('picks mysql or postgres service images based on the architecture engine', () => {
    const mysqlBundle = generateDeployment({
      target: 'docker-compose',
      artifacts: { ...artifacts, architecture: { database: { engine: 'MySQL 8' } } },
    });
    assert.match(mysqlBundle.docker.composeDev.content, /image: mysql:8/);

    const postgresBundle = generateDeployment({
      target: 'docker-compose',
      artifacts: { ...artifacts, architecture: { database: { engine: 'PostgreSQL 16' } } },
    });
    assert.match(postgresBundle.docker.composeDev.content, /image: postgres:16/);
  });
});

describe('environment bundle', () => {
  it('matches the exact variable names the generated backend already reads', () => {
    const bundle = generateDeployment({ target: 'docker', artifacts });
    const names = bundle.environment.validationRules.map((rule) => rule.name);
    assert.deepEqual(names, [
      'NODE_ENV',
      'PORT',
      'LOG_LEVEL',
      'DATABASE_URL',
      'CORS_ORIGINS',
      'JWT_SECRET',
      'VITE_API_BASE_URL',
    ]);
    assert.match(bundle.environment.envExample.content, /DATABASE_URL=/);
    assert.match(bundle.environment.envProduction.content, /__SET_IN_DEPLOYMENT_TARGET_SECRETS__/);
  });

  it('marks secrets correctly', () => {
    const bundle = generateDeployment({ target: 'docker', artifacts });
    const byName = new Map(bundle.environment.validationRules.map((r) => [r.name, r]));
    assert.equal(byName.get('DATABASE_URL')?.secret, true);
    assert.equal(byName.get('JWT_SECRET')?.secret, true);
    assert.equal(byName.get('NODE_ENV')?.secret, false);
  });
});

describe('CI/CD bundle', () => {
  it('build workflow runs lint, build, test, security scan, and docker build', () => {
    const bundle = generateDeployment({ target: 'railway', artifacts });
    const content = bundle.cicd.buildWorkflow.content;
    assert.match(content, /npm run lint/);
    assert.match(content, /npm run build/);
    assert.match(content, /npm test/);
    assert.match(content, /npm audit/);
    assert.match(content, /docker\/build-push-action/);
  });

  it('deploy workflow triggers on version tags and includes a target-specific deploy step', () => {
    const railway = generateDeployment({ target: 'railway', artifacts });
    assert.match(railway.cicd.deployWorkflow.content, /tags: \['v\*\.\*\.\*'\]/);
    assert.match(railway.cicd.deployWorkflow.content, /action-gh-release/);
    assert.match(railway.cicd.deployWorkflow.content, /railway\/cli/);

    const vercel = generateDeployment({ target: 'vercel', artifacts });
    assert.match(vercel.cicd.deployWorkflow.content, /vercel-action/);
  });
});

describe('health, monitoring, and logging bundles', () => {
  it('generates health route code covering all four endpoints', () => {
    const bundle = generateDeployment({ target: 'docker', artifacts });
    const content = bundle.health.files[0]?.content ?? '';
    assert.match(content, /'\/health'/);
    assert.match(content, /'\/health\/live'/);
    assert.match(content, /'\/health\/ready'/);
    assert.match(content, /'\/version'/);
  });

  it('generates a dependency-free Prometheus metrics module', () => {
    const bundle = generateDeployment({ target: 'docker', artifacts });
    const content = bundle.monitoring.files[0]?.content ?? '';
    assert.doesNotMatch(content, /from 'prom-client'/);
    assert.match(content, /http_requests_total/);
    assert.match(content, /http_request_duration_ms/);
  });

  it('generates a log-rotation add-on without touching the existing logger', () => {
    const bundle = generateDeployment({ target: 'docker', artifacts });
    const paths = bundle.logging.files.map((f) => f.path);
    assert.ok(paths.includes('backend/src/shared/logger/rotation.ts'));
    assert.ok(paths.includes('LOGGING.md'));
  });
});

describe('target configuration', () => {
  const casesWithFiles: [DeploymentTarget, string][] = [
    ['vercel', 'vercel.json'],
    ['netlify', 'netlify.toml'],
    ['render', 'render.yaml'],
    ['railway', 'railway.json'],
    ['aws-ecs', 'deploy/aws-ecs/task-definition.json'],
    ['gcp-cloud-run', 'deploy/gcp-cloud-run/service.yaml'],
    ['azure-app-service', 'deploy/azure-app-service/azure-pipelines.yml'],
    ['digitalocean', '.do/app.yaml'],
    ['local', 'deploy/local/README.md'],
  ];

  for (const [target, expectedPath] of casesWithFiles) {
    it(`generates ${expectedPath} for ${target}`, () => {
      const bundle = generateDeployment({ target, artifacts });
      assert.ok(bundle.targetConfig.files.some((f) => f.path === expectedPath));
    });
  }

  it('emits two files for aws-ec2 and none for docker/docker-compose', () => {
    const ec2 = generateDeployment({ target: 'aws-ec2', artifacts });
    assert.equal(ec2.targetConfig.files.length, 2);

    const docker = generateDeployment({ target: 'docker', artifacts });
    assert.equal(docker.targetConfig.files.length, 0);
  });

  it('produces valid JSON for every JSON-language target file', () => {
    for (const target of SUPPORTED_TARGETS) {
      const bundle = generateDeployment({ target, artifacts });
      for (const configFile of bundle.targetConfig.files) {
        if (configFile.language === 'json') {
          assert.doesNotThrow(
            () => JSON.parse(configFile.content),
            `invalid JSON at ${configFile.path}`,
          );
        }
      }
    }
  });
});

describe('backup and scalability docs', () => {
  it('backup doc picks the right dump command for the engine', () => {
    const mysqlBundle = generateDeployment({
      target: 'docker',
      artifacts: { ...artifacts, architecture: { database: { engine: 'MySQL' } } },
    });
    assert.match(mysqlBundle.backup.markdown, /mysqldump/);

    const postgresBundle = generateDeployment({
      target: 'docker',
      artifacts: { ...artifacts, architecture: { database: { engine: 'PostgreSQL' } } },
    });
    assert.match(postgresBundle.backup.markdown, /pg_dump/);
  });

  it('scalability doc covers all six recommendation categories', () => {
    const bundle = generateDeployment({ target: 'docker', artifacts });
    for (const heading of [
      'Horizontal scaling',
      'Vertical scaling',
      'Caching',
      'CDN',
      'Load balancing',
      'Queue workers',
    ]) {
      assert.match(bundle.scalability.markdown, new RegExp(heading));
    }
  });
});

describe('deployment guide', () => {
  it('names every generated file and the chosen target', () => {
    const bundle = generateDeployment({ target: 'render', artifacts });
    assert.match(bundle.guide.markdown, /Render/);
    assert.match(bundle.guide.markdown, /docker-compose\.yml/);
    assert.match(bundle.guide.markdown, /build\.yml/);
  });
});

describe('export manager', () => {
  it('exports every single-file format with matching content to the full bundle', () => {
    const bundle = generateDeployment({ target: 'docker-compose', artifacts });

    const compose = runExport({ format: 'docker-compose', target: 'docker-compose', artifacts });
    assert.equal(compose.kind, 'file');
    assert.equal(compose.content, bundle.docker.composeDev.content);

    const composeProd = runExport({
      format: 'docker-compose-prod',
      target: 'docker-compose',
      artifacts,
    });
    assert.equal(composeProd.kind, 'file');
    assert.equal(composeProd.content, bundle.docker.composeProd.content);

    const envExample = runExport({ format: 'env-example', target: 'docker-compose', artifacts });
    assert.equal(envExample.kind, 'file');
    assert.equal(envExample.content, bundle.environment.envExample.content);

    const buildWorkflow = runExport({
      format: 'github-workflow-build',
      target: 'docker-compose',
      artifacts,
    });
    assert.equal(buildWorkflow.kind, 'file');
    assert.equal(buildWorkflow.content, bundle.cicd.buildWorkflow.content);
  });

  it('exports the Dockerfile format as an archive with both project Dockerfiles', () => {
    const result = runExport({ format: 'dockerfile', target: 'docker', artifacts });
    assert.equal(result.kind, 'archive');
    assert.deepEqual(result.files.map((f) => f.path).sort(), [
      'backend/Dockerfile',
      'frontend/Dockerfile',
    ]);
    const backendFile = result.files.find((f) => f.path === 'backend/Dockerfile');
    assert.match(backendFile?.content ?? '', /FROM node:22-alpine/);
  });

  it('rejects the Dockerfile export when neither backend nor frontend has been generated', () => {
    assert.throws(() =>
      runExport({ format: 'dockerfile', target: 'docker', artifacts: { projectName: 'Bare' } }),
    );
  });

  it('builds each package export as an archive with the expected file count', () => {
    const dockerPackage = runExport({ format: 'docker-package', target: 'docker', artifacts });
    assert.equal(dockerPackage.kind, 'archive');
    assert.equal(dockerPackage.files.length, 6); // 2 dockerfiles + 2 dockerignores + 2 compose

    const envPackage = runExport({ format: 'environment-package', target: 'docker', artifacts });
    assert.equal(envPackage.kind, 'archive');
    assert.equal(envPackage.files.length, 4);

    const cicdPackage = runExport({ format: 'cicd-package', target: 'docker', artifacts });
    assert.equal(cicdPackage.kind, 'archive');
    assert.equal(cicdPackage.files.length, 2);

    const deploymentPackage = runExport({
      format: 'deployment-package',
      target: 'render',
      artifacts,
    });
    assert.equal(deploymentPackage.kind, 'archive');
    assert.ok(deploymentPackage.files.some((f) => f.path === 'render.yaml'));
    assert.ok(deploymentPackage.files.some((f) => f.path === 'BACKUP.md'));
    assert.ok(deploymentPackage.files.some((f) => f.path === 'deployment-guide.md'));
  });

  it('builds complete-zip with every category represented', () => {
    const result = runExport({ format: 'complete-zip', target: 'aws-ecs', artifacts });
    assert.equal(result.kind, 'archive');
    const paths = result.files.map((f) => f.path);
    assert.ok(paths.includes('backend/Dockerfile'));
    assert.ok(paths.includes('docker-compose.yml'));
    assert.ok(paths.includes('.env.example'));
    assert.ok(paths.includes('.github/workflows/build.yml'));
    assert.ok(paths.includes('backend/src/shared/health/health.routes.ts'));
    assert.ok(paths.includes('backend/src/shared/monitoring/metrics.ts'));
    assert.ok(paths.includes('BACKUP.md'));
    assert.ok(paths.includes('SCALABILITY.md'));
    assert.ok(paths.includes('deploy/aws-ecs/task-definition.json'));
    assert.ok(paths.includes('deployment-guide.md'));
    assert.equal(new Set(paths).size, paths.length, 'no duplicate paths');
  });
});

describe('status and health preview', () => {
  it('reports all 12 supported targets', () => {
    const status = getStatus();
    assert.equal(status.supportedTargets.length, 12);
    assert.equal(status.ready, true);
  });

  it('health preview describes the generated endpoints without claiming a live check', () => {
    const preview = getHealthPreview();
    assert.equal(preview.status, 'ok');
    assert.equal(preview.checks.length, 5);
    assert.match(preview.note, /not a live/);
  });
});

describe('one-click deploy execution (Phase 13, unconfigured deployment)', () => {
  const request = {
    provider: 'vercel' as const,
    projectName: artifacts.projectName,
    files: (artifacts.backend?.files ?? []).map((f) => ({
      path: `backend/${f.path}`,
      content: f.content,
    })),
  };

  it('lists all three providers with configured state and enable requirements', () => {
    const providers = getProviders();
    assert.deepEqual(
      providers.map((p) => p.id),
      ['vercel', 'railway', 'render'],
    );
    for (const provider of providers) {
      assert.ok(provider.requiredEnv.length > 0, `${provider.id} must name its env vars`);
      assert.ok(provider.strategy.length > 10, `${provider.id} must explain its strategy`);
      if (provider.id === 'vercel' && !process.env.VERCEL_TOKEN) {
        assert.equal(provider.configured, false);
      }
    }
  });

  it('plans an execution with the full step sequence and artifact summary, with no tokens', () => {
    const plan = planDeployExecution(request);
    assert.equal(plan.provider, 'vercel');
    assert.deepEqual(
      plan.steps.map((s) => s.name),
      ['build', 'deploy', 'monitor', 'url'],
    );
    assert.equal(plan.artifactSummary.fileCount, request.files.length);
    assert.equal(plan.artifactSummary.hasBackend, true);
  });

  it('refuses to execute against an unconfigured provider with a FORBIDDEN AppError', (t) => {
    if (process.env.VERCEL_TOKEN) {
      t.skip('VERCEL_TOKEN configured locally — the gate is open by design');
      return;
    }
    assert.throws(
      () => executeDeploy(request),
      (error: unknown) => {
        assert.ok(AppError.isAppError(error));
        assert.equal(error.code, 'FORBIDDEN');
        assert.match(error.message, /VERCEL_TOKEN/);
        return true;
      },
    );
  });

  it('404s on unknown execution ids instead of returning undefined', () => {
    assert.throws(
      () => getDeployExecution('no-such-execution'),
      (error: unknown) => AppError.isAppError(error) && error.code === 'NOT_FOUND',
    );
  });
});
