/**
 * A product spec derived from the requirement, without a model.
 *
 * Used when the Product Architect's model call fails. It is structurally
 * complete and deliberately unambitious: one module per requested
 * capability, one journey per role, screens from the module list. It will
 * not surface a business rule nobody stated, because inventing one is the
 * failure mode a fallback must not have.
 *
 * The agent records a finding when this path runs, so a derived spec is
 * never mistaken for a reasoned one.
 */
import type { ProductModule, ProductSpec, UserJourney } from '../../../shared/types/product.js';
import type { RequirementSpec } from '../../../shared/types/requirement.js';

export function deriveProductSpec(spec: RequirementSpec): ProductSpec {
  const roles = spec.roles.length > 0 ? spec.roles : ['User', 'Admin'];

  const modules: ProductModule[] = spec.modules.map((name) => {
    // Authentication is the one dependency that is safe to assert: every
    // other module needs it, and the requirement always implies it.
    const isAuth = /auth|login|sign|account|identity/i.test(name);
    return {
      name,
      purpose: `Handles ${name.toLowerCase()}.`,
      owns: spec.database.filter((entity) =>
        entity.toLowerCase().startsWith(name.split(' ')[0]?.toLowerCase() ?? ''),
      ),
      dependsOn: isAuth ? [] : spec.modules.filter((other) => /auth/i.test(other)),
      roles,
    };
  });

  const journeys: UserJourney[] = roles.slice(0, 3).map((role) => ({
    name: `${role} uses the product`,
    actor: role,
    steps: [
      'Signs in',
      ...spec.modules.slice(0, 3).map((module) => `Works with ${module.toLowerCase()}`),
    ],
    modules: spec.modules.slice(0, 3),
  }));

  return {
    projectName: spec.projectName,
    summary: `A ${spec.projectType} application covering ${spec.modules.join(', ')}.`,
    modules,
    journeys,
    screens: spec.modules.map((module) => ({
      name: module,
      purpose: `Primary screen for ${module.toLowerCase()}.`,
      module,
      roles,
    })),
    // Deliberately empty: a business rule nobody stated is a rule invented.
    businessRules: [],
    roles,
  };
}
