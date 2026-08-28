/**
 * The product layer: what the system should contain, before any technical
 * decision has been made.
 *
 * This sits deliberately between the requirement spec and the architecture
 * plan. The requirement says what a user asked for; the architecture says
 * how it will be built; neither answers "what are the parts of this
 * product and how do they relate" — which is the question a person asks
 * first and the one that makes the architecture reviewable.
 *
 * Nothing here names a technology. A `ProductSpec` that mentions Postgres
 * has skipped its own layer.
 */

export interface ProductModule {
  name: string;
  purpose: string;
  /** Entities/concepts this module owns, in product terms. */
  owns: string[];
  /** Other modules it needs. Names must match another module's `name`. */
  dependsOn: string[];
  /** Roles that can use it, from the spec's role list. */
  roles: string[];
}

export interface UserJourney {
  name: string;
  /** Whose journey this is. */
  actor: string;
  /** Ordered steps, in the user's language, not the system's. */
  steps: string[];
  /** Modules the journey passes through. */
  modules: string[];
}

export interface BusinessRule {
  rule: string;
  /** The module that enforces it. */
  module: string;
}

export interface ProductScreen {
  name: string;
  purpose: string;
  module: string;
  roles: string[];
}

export interface ProductSpec {
  projectName: string;
  /** One paragraph a stakeholder would recognise. */
  summary: string;
  modules: ProductModule[];
  journeys: UserJourney[];
  screens: ProductScreen[];
  businessRules: BusinessRule[];
  /** Roles carried through from the requirement spec. */
  roles: string[];
}
