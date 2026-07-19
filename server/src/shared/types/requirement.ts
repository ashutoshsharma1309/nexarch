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
}
