/**
 * Input validation for every workspace route. `artifacts` bodies
 * (export/documentation) only require `projectName` — every other field is
 * optional pipeline output, checked for presence by `export-manager.ts`
 * itself when a specific format needs it (mirrors the Dependency Graph
 * validator's "shape-check the envelope, let the service check semantics").
 */
import { body, query } from 'express-validator';
import type { ValidationChain } from 'express-validator';

import type {
  CreateGenerationInput,
  CreateProjectInput,
  DocumentationRequest,
  DocumentationType,
  ExportFormat,
  ExportRequest,
  GenerationStatus,
  ListProjectsQuery,
  ProjectArtifacts,
  ProjectStatus,
  UpdateProjectInput,
} from './workspace.types.js';

const PROJECT_STATUSES: ProjectStatus[] = ['DRAFT', 'ACTIVE', 'ARCHIVED'];
const GENERATION_STATUSES: GenerationStatus[] = [
  'PENDING',
  'ANALYZING',
  'PLANNING',
  'GENERATING',
  'REVIEWING',
  'COMPLETED',
  'FAILED',
];
const EXPORT_FORMATS: ExportFormat[] = [
  'zip-project',
  'docker-package',
  'readme',
  'openapi',
  'postman-collection',
  'prisma-schema',
  'sql-schema',
  'architecture-report',
  'dependency-graph',
  'security-report',
  'project-manifest',
];
const DOCUMENTATION_TYPES: DocumentationType[] = [
  'readme',
  'api',
  'architecture',
  'database',
  'security',
  'deployment-guide',
  'developer-guide',
];

export const createProjectValidation: ValidationChain[] = [
  body('name')
    .isString()
    .trim()
    .isLength({ min: 1, max: 120 })
    .withMessage('name is required (max 120 chars)'),
  body('description').optional({ values: 'null' }).isString().isLength({ max: 5000 }),
];

export const updateProjectValidation: ValidationChain[] = [
  body('name').optional().isString().trim().isLength({ min: 1, max: 120 }),
  body('description').optional({ values: 'null' }).isString().isLength({ max: 5000 }),
  body('status')
    .optional()
    .isIn(PROJECT_STATUSES)
    .withMessage(`status must be one of ${PROJECT_STATUSES.join(', ')}`),
  body('favorite').optional().isBoolean(),
];

export const listProjectsValidation: ValidationChain[] = [
  query('search').optional().isString(),
  query('status').optional().isIn(PROJECT_STATUSES),
  query('favorite').optional().isBoolean(),
];

export const createGenerationValidation: ValidationChain[] = [
  body('prompt').isString().trim().isLength({ min: 1 }).withMessage('prompt is required'),
  body('status').optional().isIn(GENERATION_STATUSES),
  body('model').optional().isString(),
  body('tokensUsed').optional().isInt({ min: 0 }),
  body('costUsd').optional().isFloat({ min: 0 }),
  body('durationMs').optional().isInt({ min: 0 }),
  body('filesGenerated').optional().isInt({ min: 0 }),
  body('filesModified').optional().isInt({ min: 0 }),
  body('error').optional().isString(),
];

export const exportValidation: ValidationChain[] = [
  body('format')
    .isIn(EXPORT_FORMATS)
    .withMessage(`format must be one of ${EXPORT_FORMATS.join(', ')}`),
  body('artifacts').isObject().withMessage('artifacts is required'),
  body('artifacts.projectName')
    .isString()
    .trim()
    .isLength({ min: 1 })
    .withMessage('artifacts.projectName is required'),
  body('projectId').optional().isString(),
];

export const documentationValidation: ValidationChain[] = [
  body('type')
    .isIn(DOCUMENTATION_TYPES)
    .withMessage(`type must be one of ${DOCUMENTATION_TYPES.join(', ')}`),
  body('artifacts').isObject().withMessage('artifacts is required'),
  body('artifacts.projectName')
    .isString()
    .trim()
    .isLength({ min: 1 })
    .withMessage('artifacts.projectName is required'),
];

export const historyValidation: ValidationChain[] = [
  query('projectId').optional().isString(),
  query('limit').optional().isInt({ min: 1, max: 500 }).toInt(),
];

export function readCreateProjectRequest(payload: Record<string, unknown>): CreateProjectInput {
  return {
    name: payload.name as string,
    description: (payload.description as string | null | undefined) ?? undefined,
  };
}

export function readUpdateProjectRequest(payload: Record<string, unknown>): UpdateProjectInput {
  const input: UpdateProjectInput = {};
  if (payload.name !== undefined) input.name = payload.name as string;
  if (payload.description !== undefined) input.description = payload.description as string | null;
  if (payload.status !== undefined) input.status = payload.status as ProjectStatus;
  if (payload.favorite !== undefined) input.favorite = payload.favorite as boolean;
  return input;
}

export function readListProjectsQuery(params: Record<string, unknown>): ListProjectsQuery {
  return {
    search: params.search as string | undefined,
    status: params.status as ProjectStatus | undefined,
    favorite:
      params.favorite === undefined
        ? undefined
        : params.favorite === 'true' || params.favorite === true,
  };
}

export function readCreateGenerationRequest(
  projectId: string,
  payload: Record<string, unknown>,
): CreateGenerationInput {
  return {
    projectId,
    prompt: payload.prompt as string,
    status: payload.status as GenerationStatus | undefined,
    model: payload.model as string | undefined,
    tokensUsed: payload.tokensUsed as number | undefined,
    costUsd: payload.costUsd as number | undefined,
    durationMs: payload.durationMs as number | undefined,
    filesGenerated: payload.filesGenerated as number | undefined,
    filesModified: payload.filesModified as number | undefined,
    error: payload.error as string | undefined,
  };
}

export function readExportRequest(payload: Record<string, unknown>): ExportRequest {
  return {
    format: payload.format as ExportFormat,
    artifacts: payload.artifacts as ProjectArtifacts,
    projectId: payload.projectId as string | undefined,
  };
}

export function readDocumentationRequest(payload: Record<string, unknown>): DocumentationRequest {
  return {
    type: payload.type as DocumentationType,
    artifacts: payload.artifacts as ProjectArtifacts,
  };
}
