/**
 * The pipeline contract between the Requirement Analyzer (producer) and the
 * Architecture Planner (consumer). Lives in shared/ because module islands
 * never import each other's internals — stage contracts are shared types.
 */
export interface RequirementSpec {
  projectName: string;
  projectType: string;
  roles: string[];
  modules: string[];
  frontend: string[];
  backend: string[];
  database: string[];
  authentication: string[];
  integrations: string[];
  /** Features the domain usually needs that the prompt never mentioned. */
  missingRequirements: string[];

  /* ── Planning-mesh detail ───────────────────────────────────────────
   *
   * Every field below is optional, and deliberately so. The deterministic
   * pipeline reads only the fields above and must keep working unchanged;
   * the Requirement Analyst agent fills these in as well, so the planning
   * mesh has the depth it needs without the legacy contract breaking.
   */

  /** One sentence: what this product is for. */
  goal?: string;
  /** Capabilities the system must provide, in the user's terms. */
  functionalRequirements?: string[];
  /** Qualities it must have — performance, availability, compliance. */
  nonFunctionalRequirements?: string[];
  /** Limits the solution must respect. */
  constraints?: string[];
  /** What was taken as given because the request did not say. */
  assumptions?: string[];
  securityRequirements?: string[];
  /** Testable statements of done. */
  acceptanceCriteria?: string[];
}
