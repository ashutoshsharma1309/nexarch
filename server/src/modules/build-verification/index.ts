/**
 * Real build verification and evidence-driven repair of generated projects.
 *
 * Not an AppModule: nothing here is reachable over HTTP. The pipeline and the
 * enhancement workflow call these two functions directly.
 */
export { repairVerifiedFailures } from './repair-failures.js';
export { verifyProject } from './verify-project.js';
export type {
  DeclaredRoute,
  ProjectFile,
  RepairAttempt,
  RepairOptions,
  RepairModelUsage,
  RepairResult,
  RouteCheck,
  VerificationResult,
  VerificationStep,
  VerificationStepId,
  VerificationStepStatus,
  VerifyProjectOptions,
} from './build-verification.types.js';
