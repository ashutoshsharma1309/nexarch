import type { AppModule } from '../../shared/types/module.js';
import { healthRouter } from './health.router.js';

export const healthModule: AppModule = {
  name: 'health',
  basePath: '/health',
  description: 'Liveness, readiness and dependency diagnostics',
  router: healthRouter,
};
