/**
 * Input validation for Phase 4. The designer consumes only the structured
 * outputs of earlier stages — `architecture` (the SDS) and `requirements`
 * (the analyzer spec) — never a raw prompt. Validation confirms the load-
 * bearing shape is present; the generators defend the rest.
 */
import { body } from 'express-validator';
import type { ValidationChain } from 'express-validator';

import type { ArchitecturePlan } from '../../shared/types/architecture.js';
import type { RequirementSpec } from '../../shared/types/requirement.js';

export const designValidation: ValidationChain[] = [
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
  body('architecture.database.entities')
    .isArray({ min: 1 })
    .withMessage('architecture.database.entities must be a non-empty array'),
  body('architecture.database.entities.*.name').isString().withMessage('each entity needs a name'),
  body('architecture.database.entities.*.tableName')
    .isString()
    .withMessage('each entity needs a tableName'),
  body('architecture.apiModules').isArray().withMessage('architecture.apiModules must be an array'),
  body('requirements')
    .exists({ values: 'falsy' })
    .withMessage('requirements is required')
    .bail()
    .isObject()
    .withMessage('requirements must be an object'),
  body('requirements.projectType').isString().withMessage('requirements.projectType is required'),
  body('requirements.roles').isArray().withMessage('requirements.roles must be an array'),
];

export interface DesignRequestBody {
  architecture: ArchitecturePlan;
  requirements: RequirementSpec;
}

/** Narrow the validated body. Optional list fields on the spec default to
 * empty arrays so the generators always receive a total requirement spec. */
export function readDesignRequest(body: Record<string, unknown>): DesignRequestBody {
  const architecture = body.architecture as ArchitecturePlan;
  const rawRequirements = body.requirements as Partial<RequirementSpec>;

  const list = (value: unknown): string[] => (Array.isArray(value) ? (value as string[]) : []);

  const requirements: RequirementSpec = {
    projectName: rawRequirements.projectName ?? architecture.meta.projectName,
    projectType: rawRequirements.projectType ?? architecture.meta.projectType,
    roles: list(rawRequirements.roles),
    modules: list(rawRequirements.modules),
    frontend: list(rawRequirements.frontend),
    backend: list(rawRequirements.backend),
    database: list(rawRequirements.database),
    authentication: list(rawRequirements.authentication),
    integrations: list(rawRequirements.integrations),
    missingRequirements: list(rawRequirements.missingRequirements),
  };

  return { architecture, requirements };
}
