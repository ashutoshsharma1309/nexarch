/**
 * Deployment service — composes the `lib/` generators into the full
 * bundle, dispatches exports, and reports this module's own readiness.
 * Stateless: every call re-derives its result from the request body, the
 * same "no shared runtime state" contract Dependency Graph's build/analyze
 * use.
 */
import { generateBackupDocs } from './lib/backup-generator.js';
import { generateDockerBundle } from './lib/docker-generator.js';
import { generateEnvironmentBundle } from './lib/environment-generator.js';
import { runExport as runExportInternal } from './lib/export-manager.js';
import { generateDeploymentGuide } from './lib/guide-generator.js';
import { generateHealthBundle } from './lib/health-generator.js';
import { generateLoggingBundle } from './lib/logging-generator.js';
import { generateMonitoringBundle } from './lib/monitoring-generator.js';
import { generateCiCdBundle } from './lib/pipeline-generator.js';
import { generateScalabilityDocs } from './lib/scalability-generator.js';
import { generateTargetConfig } from './lib/target-config-generator.js';
import type {
  DeploymentBundle,
  DeploymentHealthPreview,
  DeploymentStatus,
  DeploymentTarget,
  ExportRequest,
  ExportResult,
  GenerateDeploymentRequest,
} from './deployment.types.js';

export const SUPPORTED_TARGETS: DeploymentTarget[] = [
  'docker',
  'docker-compose',
  'vercel',
  'netlify',
  'render',
  'railway',
  'aws-ec2',
  'aws-ecs',
  'gcp-cloud-run',
  'azure-app-service',
  'digitalocean',
  'local',
];

export function generateDeployment(request: GenerateDeploymentRequest): DeploymentBundle {
  const { target, artifacts } = request;

  const docker = generateDockerBundle(artifacts);
  const environment = generateEnvironmentBundle(artifacts);
  const cicd = generateCiCdBundle(target, artifacts);
  const health = generateHealthBundle();
  const monitoring = generateMonitoringBundle();
  const logging = generateLoggingBundle();
  const backup = generateBackupDocs(artifacts);
  const scalability = generateScalabilityDocs(artifacts);
  const targetConfig = generateTargetConfig(target, artifacts);
  const guideMarkdown = generateDeploymentGuide(target, artifacts, docker, environment, cicd);

  return {
    target,
    meta: {
      projectName: artifacts.projectName,
      generatedAt: new Date().toISOString(),
      generator: 'nexarch-deployment-engine@1.0.0',
    },
    docker,
    environment,
    cicd,
    health,
    monitoring,
    logging,
    backup,
    scalability,
    targetConfig,
    guide: { markdown: guideMarkdown },
  };
}

export function runExport(request: ExportRequest): ExportResult {
  return runExportInternal(request);
}

export function getStatus(): DeploymentStatus {
  return {
    supportedTargets: SUPPORTED_TARGETS,
    ready: true,
    capabilities: [
      'docker',
      'docker-compose',
      'github-actions',
      'environment-templates',
      'health-checks',
      'monitoring',
      'logging',
      'backup-docs',
      'scalability-docs',
      'target-configs',
    ],
  };
}

export function getHealthPreview(): DeploymentHealthPreview {
  return {
    status: 'ok',
    note: 'Preview of the health-check surface generated for downstream projects — not a live deployment check, since this module never deploys anything itself.',
    checks: [
      { path: '/health', purpose: 'Full report — process uptime plus a database ping' },
      { path: '/health/live', purpose: 'Liveness — no dependency checks' },
      { path: '/health/ready', purpose: 'Readiness — database reachability only' },
      { path: '/version', purpose: 'Build metadata: version, commit, build timestamp' },
      {
        path: '/metrics',
        purpose: 'Prometheus exposition format — requests, latency, errors, process stats',
      },
    ],
    generatedAt: new Date().toISOString(),
  };
}
