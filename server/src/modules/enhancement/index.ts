/**
 * Enhancement: real, planned, verified changes to an existing project.
 *
 * Mounted at `/projects`, beside project edits. The two share one active job
 * per project.
 */
import type { AppModule } from '../../shared/types/module.js';
import { enhancementRouter } from './enhancement.router.js';

export {
  applyEnhancement,
  cancelEnhancement,
  currentEnhancementJob,
  getEnhancementJob,
  planEnhancement,
  revertEnhancement,
} from './enhancement.service.js';
export type { EnhancementPlan, EnhancementResult } from './enhancement.types.js';

export const enhancementModule: AppModule = {
  name: 'enhancement',
  basePath: '/projects',
  description: 'Plan and apply verified changes to an existing project',
  router: enhancementRouter,
};
