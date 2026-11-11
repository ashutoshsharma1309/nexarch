import type { AppModule } from '../../shared/types/module.js';
import { observabilityRouter } from './observability.router.js';

export const observabilityModule: AppModule = {
  name: 'observability',
  basePath: '/observability',
  description: 'Execution timelines assembled from operational events',
  router: observabilityRouter,
};
