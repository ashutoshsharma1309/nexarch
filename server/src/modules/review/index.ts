/**
 * Review module — scaffold.
 *
 * Future home of post-generation quality control: static analysis of
 * generated code, optimization passes, and the review verdict that gates a
 * generation run's transition from REVIEWING to COMPLETED.
 */
import type { AppModule } from '../../shared/types/module.js';
import { createScaffoldRouter } from '../../shared/utils/module-scaffold.js';

export const reviewModule: AppModule = {
  name: 'review',
  basePath: '/review',
  description: 'Static analysis and optimization of generated code',
  router: createScaffoldRouter({
    module: 'review',
    summary: 'Static analysis and optimization of generated code',
    plannedPhase: 2,
    capabilities: ['static-analysis', 'optimization-pass', 'review-verdict'],
    status: 'scaffold',
  }),
};
