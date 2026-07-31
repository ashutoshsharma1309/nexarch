/**
 * Input validation. `artifacts` only requires `projectName` — every other
 * field is optional pipeline output the generators degrade gracefully
 * without (same shape-check-the-envelope approach as the Workspace
 * module's export/documentation validators).
 */
import { body } from 'express-validator';
import type { ValidationChain } from 'express-validator';

import type {
  DeployProviderId,
  DeploymentArtifacts,
  DeploymentTarget,
  ExecuteDeployRequest,
  ExportFormat,
  ExportRequest,
  GenerateDeploymentRequest,
} from './deployment.types.js';

const DEPLOYMENT_TARGETS: DeploymentTarget[] = [
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

const EXPORT_FORMATS: ExportFormat[] = [
  'dockerfile',
  'docker-compose',
  'docker-compose-prod',
  'github-workflow-build',
  'github-workflow-deploy',
  'env-example',
  'deployment-guide',
  'complete-zip',
  'docker-package',
  'deployment-package',
  'environment-package',
  'cicd-package',
];

export const generateValidation: ValidationChain[] = [
  body('target')
    .isIn(DEPLOYMENT_TARGETS)
    .withMessage(`target must be one of ${DEPLOYMENT_TARGETS.join(', ')}`),
  body('artifacts').isObject().withMessage('artifacts is required'),
  body('artifacts.projectName')
    .isString()
    .trim()
    .isLength({ min: 1 })
    .withMessage('artifacts.projectName is required'),
];

export const exportValidation: ValidationChain[] = [
  body('format')
    .isIn(EXPORT_FORMATS)
    .withMessage(`format must be one of ${EXPORT_FORMATS.join(', ')}`),
  body('target')
    .isIn(DEPLOYMENT_TARGETS)
    .withMessage(`target must be one of ${DEPLOYMENT_TARGETS.join(', ')}`),
  body('artifacts').isObject().withMessage('artifacts is required'),
  body('artifacts.projectName')
    .isString()
    .trim()
    .isLength({ min: 1 })
    .withMessage('artifacts.projectName is required'),
];

export function readGenerateRequest(payload: Record<string, unknown>): GenerateDeploymentRequest {
  return {
    target: payload.target as DeploymentTarget,
    artifacts: payload.artifacts as DeploymentArtifacts,
  };
}

export function readExportRequest(payload: Record<string, unknown>): ExportRequest {
  return {
    format: payload.format as ExportFormat,
    target: payload.target as DeploymentTarget,
    artifacts: payload.artifacts as DeploymentArtifacts,
  };
}

/* ── One-click deploy execution (Phase 13) ────────────────────────────── */

const DEPLOY_PROVIDERS: DeployProviderId[] = ['vercel', 'railway', 'render'];

export const executeDeployValidation: ValidationChain[] = [
  body('provider')
    .isIn(DEPLOY_PROVIDERS)
    .withMessage(`provider must be one of ${DEPLOY_PROVIDERS.join(', ')}`),
  body('projectName').isString().trim().isLength({ min: 1 }).withMessage('projectName is required'),
  body('files').isArray({ min: 1 }).withMessage('files must be a non-empty array'),
  body('files.*.path')
    .isString()
    .trim()
    .isLength({ min: 1 })
    .withMessage('every file needs a path'),
  body('files.*.content').isString().withMessage('every file needs string content'),
  body('env').optional().isObject().withMessage('env must be a string map'),
];

export function readExecuteDeployRequest(payload: Record<string, unknown>): ExecuteDeployRequest {
  return {
    provider: payload.provider as DeployProviderId,
    projectName: payload.projectName as string,
    files: payload.files as { path: string; content: string }[],
    env: payload.env as Record<string, string> | undefined,
  };
}
