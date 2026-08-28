/**
 * The Context Engine's task vocabulary, lifted into the shared contracts.
 *
 * It lives here rather than inside the engine because an agent declares
 * which task its context is compiled for, and an agent definition must not
 * have to import the engine to say so.
 */
export type TaskType =
  | 'REQUIREMENT_ANALYSIS'
  | 'PRODUCT_PLANNING'
  | 'ARCHITECTURE_PLANNING'
  | 'DATABASE_DESIGN'
  | 'BACKEND_GENERATION'
  | 'FRONTEND_GENERATION'
  | 'SECURITY_REVIEW'
  /** Reviewing what the project depends on, and whether it needs all of it. */
  | 'DEPENDENCY_REVIEW'
  /** Reviewing the generated source for maintainability and consistency. */
  | 'QUALITY_REVIEW'
  /** Reviewing the generated interface as a user would experience it. */
  | 'UX_REVIEW'
  /** Deciding what deserves a test, from the product's own priorities. */
  | 'TEST_PLANNING'
  /** Making the smallest change that resolves a validated finding. */
  | 'REPAIR'
  | 'CODE_REVIEW'
  | 'IMPACT_EXPLANATION';
