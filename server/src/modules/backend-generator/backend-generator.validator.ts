/**
 * Input validation for Phase 5. The generator consumes only the structured
 * outputs of earlier stages — architecture, requirements, the database
 * design bundle (databaseDesign, prismaSchema, openapi, validationRules,
 * entityMetadata) — never a raw prompt. Validation confirms the load-
 * bearing shape is present; the emitters defend the rest.
 */
import { body } from 'express-validator';
import type { ValidationChain } from 'express-validator';

import type { ArchitecturePlan } from '../../shared/types/architecture.js';
import type {
  DatabaseDesign,
  EntityMetadataSet,
  OpenApiDocument,
  ValidationRuleSet,
} from '../../shared/types/design.js';
import type { RequirementSpec } from '../../shared/types/requirement.js';

export const generateValidation: ValidationChain[] = [
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
  body('databaseDesign.tables')
    .isArray({ min: 1 })
    .withMessage('databaseDesign.tables must be a non-empty array'),
  body('prismaSchema')
    .exists({ values: 'falsy' })
    .withMessage('prismaSchema is required')
    .bail()
    .isString()
    .withMessage('prismaSchema must be a string'),
  body('openapi')
    .exists({ values: 'falsy' })
    .withMessage('openapi is required')
    .bail()
    .isObject()
    .withMessage('openapi must be an object'),
  body('openapi.paths').isObject().withMessage('openapi.paths is required'),
  body('openapi.tags').isArray().withMessage('openapi.tags must be an array'),
  body('validationRules').optional().isObject().withMessage('validationRules must be an object'),
  body('entityMetadata').optional().isObject().withMessage('entityMetadata must be an object'),
];

export interface GenerateRequestBody {
  architecture: ArchitecturePlan;
  requirements: RequirementSpec;
  databaseDesign: DatabaseDesign;
  prismaSchema: string;
  openapi: OpenApiDocument;
  validationRules: ValidationRuleSet;
  entityMetadata: EntityMetadataSet;
}

/** Narrow the validated body, defaulting the optional artifacts so the
 * generator always has a total input even if a caller omits them. */
export function readGenerateRequest(body: Record<string, unknown>): GenerateRequestBody {
  const architecture = body.architecture as ArchitecturePlan;
  const requirements = body.requirements as RequirementSpec;
  const databaseDesign = body.databaseDesign as DatabaseDesign;
  const openapi = body.openapi as OpenApiDocument;

  const validationRules = (body.validationRules as ValidationRuleSet | undefined) ?? {
    meta: {
      projectName: architecture.meta.projectName,
      generatedAt: architecture.meta.generatedAt,
    },
    entities: [],
  };
  const entityMetadata = (body.entityMetadata as EntityMetadataSet | undefined) ?? {
    meta: {
      projectName: architecture.meta.projectName,
      generatedAt: architecture.meta.generatedAt,
    },
    entities: [],
  };

  return {
    architecture,
    requirements,
    databaseDesign,
    prismaSchema: body.prismaSchema as string,
    openapi,
    validationRules,
    entityMetadata,
  };
}
