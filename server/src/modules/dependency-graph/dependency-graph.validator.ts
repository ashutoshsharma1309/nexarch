/**
 * Input validation. Every endpoint consumes the same core bundle
 * (requirements, architecture, database design, and the backend/frontend/
 * security bundles) — build/analyze/regenerate all re-derive the graph
 * from scratch rather than trusting cached server state, so they all
 * validate the same shape.
 */
import { body } from 'express-validator';
import type { ValidationChain } from 'express-validator';

import type { ArchitecturePlan } from '../../shared/types/architecture.js';
import type { DatabaseDesign } from '../../shared/types/design.js';
import type { RequirementSpec } from '../../shared/types/requirement.js';
import type { GraphInputs, RegenerateInputs } from './dependency-graph.service.js';
import type {
  BackendBundle,
  FrontendBundle,
  SecurityBundleInput,
} from './dependency-graph.types.js';

export const graphInputsValidation: ValidationChain[] = [
  body('architecture')
    .exists({ values: 'falsy' })
    .withMessage('architecture is required — run the Architecture Planner first')
    .bail()
    .isObject()
    .withMessage('architecture must be an object'),
  body('architecture.meta.projectName')
    .isString()
    .withMessage('architecture.meta.projectName is required'),
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
  body('backend')
    .exists({ values: 'falsy' })
    .withMessage('backend is required — run the Backend Generator first')
    .bail()
    .isObject()
    .withMessage('backend must be an object'),
  body('backend.files').isArray().withMessage('backend.files must be an array'),
  body('frontend')
    .exists({ values: 'falsy' })
    .withMessage('frontend is required — run the Frontend Generator first')
    .bail()
    .isObject()
    .withMessage('frontend must be an object'),
  body('frontend.files').isArray().withMessage('frontend.files must be an array'),
  body('security')
    .exists({ values: 'falsy' })
    .withMessage('security is required — run the Security Engine first')
    .bail()
    .isObject()
    .withMessage('security must be an object'),
];

export const changeRequestValidation: ValidationChain[] = [
  body('changeRequest')
    .isString()
    .trim()
    .isLength({ min: 3 })
    .withMessage('changeRequest must describe the requested change in at least 3 characters'),
];

export const specDiffValidation: ValidationChain[] = [
  body('newRequirements')
    .exists({ values: 'falsy' })
    .withMessage('newRequirements is required — analyze the new prompt first')
    .bail()
    .isObject()
    .withMessage('newRequirements must be a RequirementSpec object'),
  body('newRequirements.projectName')
    .isString()
    .withMessage('newRequirements.projectName is required'),
];

export const regenerateValidation: ValidationChain[] = [
  body('newBackend')
    .exists({ values: 'falsy' })
    .bail()
    .isObject()
    .withMessage('newBackend must be an object'),
  body('newFrontend')
    .exists({ values: 'falsy' })
    .bail()
    .isObject()
    .withMessage('newFrontend must be an object'),
  body('newSecurity')
    .exists({ values: 'falsy' })
    .bail()
    .isObject()
    .withMessage('newSecurity must be an object'),
  body('manualEdits').optional().isObject().withMessage('manualEdits must be a path->content map'),
];

function readGraphInputs(payload: Record<string, unknown>): GraphInputs {
  const security = (payload.security as Partial<SecurityBundleInput> | undefined) ?? {};
  return {
    requirements: payload.requirements as RequirementSpec,
    architecture: payload.architecture as ArchitecturePlan,
    database: payload.databaseDesign as DatabaseDesign,
    backend: payload.backend as BackendBundle,
    frontend: payload.frontend as FrontendBundle,
    security: {
      backendFiles: security.backendFiles ?? [],
      frontendFiles: security.frontendFiles ?? [],
      rbac: security.rbac ?? { roles: [], permissions: [] },
    },
  };
}

export function readBuildRequest(body: Record<string, unknown>): GraphInputs {
  return readGraphInputs(body);
}

export function readAnalyzeRequest(
  body: Record<string, unknown>,
): GraphInputs & { changeRequest: string } {
  return { ...readGraphInputs(body), changeRequest: body.changeRequest as string };
}

export function readSpecDiffRequest(
  body: Record<string, unknown>,
): GraphInputs & { newRequirements: RequirementSpec } {
  return {
    ...readGraphInputs(body),
    newRequirements: body.newRequirements as RequirementSpec,
  };
}

export function readRegenerateRequest(body: Record<string, unknown>): RegenerateInputs {
  return {
    ...readGraphInputs(body),
    changeRequest: body.changeRequest as string,
    newBackend: body.newBackend as BackendBundle,
    newFrontend: body.newFrontend as FrontendBundle,
    newSecurity: {
      backendFiles:
        (body.newSecurity as Partial<SecurityBundleInput> | undefined)?.backendFiles ?? [],
      frontendFiles:
        (body.newSecurity as Partial<SecurityBundleInput> | undefined)?.frontendFiles ?? [],
      rbac: (body.newSecurity as Partial<SecurityBundleInput> | undefined)?.rbac ?? {
        roles: [],
        permissions: [],
      },
    },
    manualEdits: body.manualEdits as Record<string, string> | undefined,
  };
}
