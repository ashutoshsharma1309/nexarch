import type { AppModule } from '../../shared/types/module.js';
import { builderAgentRouter } from './builder-agent.router.js';

export const builderAgentModule: AppModule = {
  name: 'builder-agent',
  basePath: '/builder',
  description:
    'The Builder Agent: takes a task and carries it to a running website by orchestrating the pipeline, the agent mesh, repair and the local runner',
  router: builderAgentRouter,
};
