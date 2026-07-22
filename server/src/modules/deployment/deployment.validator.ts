/**
 * Input validation. `artifacts` only requires `projectName` — every other
 * field is optional pipeline output the generators degrade gracefully
 * without (same shape-check-the-envelope approach as the Workspace
 * module's export/documentation validators).
 */
import { body } from 'express-validator';
import type { ValidationChain } from 'express-validator';

import type {
  DeploymentArtifacts,
  DeploymentTarget,
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
