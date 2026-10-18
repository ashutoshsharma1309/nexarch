/**
 * ArchitectureValidator: guards the module boundary. The planner consumes
 * only structured RequirementSpec JSON — never raw prompts — so the shape
 * is enforced here with field-level errors, and optional list fields are
 * normalized to empty arrays before the service sees them.
 */
import { body } from 'express-validator';
import type { ValidationChain } from 'express-validator';

import type { RequirementSpec } from '../../shared/types/requirement.js';

function stringArray(field: string, { required }: { required: boolean }): ValidationChain {
  let chain = body(field);
  chain = required
    ? chain.exists().withMessage(`${field} is required`).bail()
    : chain.optional({ values: 'undefined' });
  return chain
    .isArray(required ? { min: 1 } : {})
    .withMessage(`${field} must be a ${required ? 'non-empty ' : ''}array`)
    .bail()
    .custom((value: unknown[]) =>
      value.every((item) => typeof item === 'string' && item.trim() !== ''),
    )
    .withMessage(`${field} must contain only non-empty strings`);
}

export const architectureValidation: ValidationChain[] = [
  body('projectName')
    .exists({ values: 'falsy' })
    .withMessage('projectName is required')
    .bail()
    .isString()
    .withMessage('projectName must be a string')
    .bail()
    .trim()
    .isLength({ min: 2, max: 120 })
    .withMessage('projectName must be 2–120 characters'),
  body('projectType')
    .exists({ values: 'falsy' })
    .withMessage('projectType is required — run the prompt through the Requirement Analyzer first')
    .bail()
    .isString()
    .withMessage('projectType must be a string')
    .bail()
    .trim()
    .notEmpty(),
  stringArray('roles', { required: true }),
  stringArray('modules', { required: true }),
  stringArray('database', { required: false }),
  stringArray('authentication', { required: false }),
  stringArray('frontend', { required: false }),
  stringArray('backend', { required: false }),
  stringArray('integrations', { required: false }),
  stringArray('missingRequirements', { required: false }),
  body('goal').optional({ values: 'undefined' }).isString().withMessage('goal must be a string'),
  stringArray('functionalRequirements', { required: false }),
  stringArray('nonFunctionalRequirements', { required: false }),
  stringArray('constraints', { required: false }),
  stringArray('assumptions', { required: false }),
  stringArray('securityRequirements', { required: false }),
  stringArray('acceptanceCriteria', { required: false }),
];

/**
 * Fill optional arrays so the planners always receive a total spec, and
 * carry the planning-mesh detail through untouched.
 *
 * The detail used to be dropped here. A caller that had already been
 * through the Requirement Analyst sent a spec with a goal, constraints,
 * assumptions and acceptance criteria; this normalizer rebuilt the spec
 * from the legacy fields alone, and the planner received a bare module
 * list. The depth was not rejected, which would at least have been
 * visible — it was silently discarded one call before the stage that
 * needed it.
 *
 * Every detail field is optional on `RequirementSpec`, and under
 * `exactOptionalPropertyTypes` an explicit `undefined` is not the same as
 * an absent key, so each is spread in only when the caller actually sent
 * something. An empty array is treated as "not sent": it carries no more
 * information than absence, and a present-but-empty `constraints` would
 * read downstream as "there are none" rather than "none were stated".
 */
export function normalizeSpec(body: Record<string, unknown>): RequirementSpec {
  const list = (field: string): string[] =>
    Array.isArray(body[field]) ? (body[field] as string[]) : [];

  const goal = typeof body.goal === 'string' ? body.goal.trim() : '';
  const functionalRequirements = list('functionalRequirements');
  const nonFunctionalRequirements = list('nonFunctionalRequirements');
  const constraints = list('constraints');
  const assumptions = list('assumptions');
  const securityRequirements = list('securityRequirements');
  const acceptanceCriteria = list('acceptanceCriteria');

  return {
    projectName: String(body.projectName).trim(),
    projectType: String(body.projectType).trim(),
    roles: list('roles'),
    modules: list('modules'),
    frontend: list('frontend'),
    backend: list('backend'),
    database: list('database'),
    authentication: list('authentication'),
    integrations: list('integrations'),
    missingRequirements: list('missingRequirements'),
    ...(goal ? { goal } : {}),
    ...(functionalRequirements.length ? { functionalRequirements } : {}),
    ...(nonFunctionalRequirements.length ? { nonFunctionalRequirements } : {}),
    ...(constraints.length ? { constraints } : {}),
    ...(assumptions.length ? { assumptions } : {}),
    ...(securityRequirements.length ? { securityRequirements } : {}),
    ...(acceptanceCriteria.length ? { acceptanceCriteria } : {}),
  };
}
