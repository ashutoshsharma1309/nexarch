/**
 * Input validation for Phase 7. The engine consumes only the structured
 * outputs of earlier stages — requirements, architecture, database design,
 * the OpenAPI contract, and the backend/frontend manifests — never a raw
 * prompt. Validation confirms the load-bearing shape is present; the
 * scanner and emitters defend the rest.
 */
import { body } from 'express-validator';
import type { ValidationChain } from 'express-validator';

import type { ArchitecturePlan } from '../../shared/types/architecture.js';
import type {
  DatabaseDesign,
  EntityMetadataSet,
  OpenApiDocument,
} from '../../shared/types/design.js';
import type { RequirementSpec } from '../../shared/types/requirement.js';
import type { SecurityInputs } from './security-engine.service.js';
import type { BackendManifest, FrontendManifest } from './security-engine.types.js';

export const securityValidation: ValidationChain[] = [
  body('architecture')
    .exists({ values: 'falsy' })
    .withMessage('architecture is required — run the Architecture Planner first')
    .bail()
    .isObject()
    .withMessage('architecture must be an object'),
  body('architecture.meta.projectName')
    .isString()
    .withMessage('architecture.meta.projectName is required'),
  body('architecture.meta.projectType')
    .isString()
    .withMessage('architecture.meta.projectType is required'),
  body('requirements')
    .exists({ values: 'falsy' })
    .withMessage('requirements is required')
    .bail()
    .isObject()
    .withMessage('requirements must be an object'),
  body('databaseDesign')
    .exists({ values: 'falsy' })
    .withMessage('databaseDesign is required — run the Database Designer first')
    .bail()
    .isObject()
    .withMessage('databaseDesign must be an object'),
  body('databaseDesign.tables').isArray().withMessage('databaseDesign.tables must be an array'),
  body('openapi')
    .exists({ values: 'falsy' })
    .withMessage('openapi is required')
    .bail()
    .isObject()
    .withMessage('openapi must be an object'),
  body('openapi.tags').isArray().withMessage('openapi.tags must be an array'),
  body('backendManifest')
    .exists({ values: 'falsy' })
    .withMessage('backendManifest is required — run the Backend Generator first')
    .bail()
    .isObject()
    .withMessage('backendManifest must be an object'),
  body('backendManifest.modules').isArray().withMessage('backendManifest.modules must be an array'),
  body('entityMetadata').optional().isObject().withMessage('entityMetadata must be an object'),
  body('frontendManifest').optional().isObject().withMessage('frontendManifest must be an object'),
];

/** Narrow the validated body, defaulting optional artifacts so the engine
 * always has a total input even if a caller omits them. */
export function readSecurityRequest(body: Record<string, unknown>): SecurityInputs {
  const architecture = body.architecture as ArchitecturePlan;
  const requirements = body.requirements as RequirementSpec;
  const database = body.databaseDesign as DatabaseDesign;
  const openapi = body.openapi as OpenApiDocument;
  const backendManifest = (body.backendManifest as BackendManifest | undefined) ?? {
    modules: [],
    routes: [],
  };
  const entityMetadata = (body.entityMetadata as EntityMetadataSet | undefined) ?? {
    meta: {
      projectName: architecture.meta.projectName,
      generatedAt: architecture.meta.generatedAt,
    },
    entities: [],
  };
  const frontendManifest = (body.frontendManifest as FrontendManifest | undefined) ?? { pages: [] };

  return {
    requirements,
    architecture,
    database,
    openapi,
    entityMetadata,
    backendManifest,
    frontendManifest,
  };
}
