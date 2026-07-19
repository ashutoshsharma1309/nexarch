/**
 * Architecture Planner module — the second implemented stage of the
 * generation pipeline. Consumes a RequirementSpec and produces the
 * Software Design Specification (plan JSON + Markdown document) that the
 * Database Designer and code generators build from.
 * Public surface: this module definition only.
 */
import type { AppModule } from '../../shared/types/module.js';
import { architectureRouter } from './architecture.router.js';

export const architectureModule: AppModule = {
  name: 'architecture',
  basePath: '/architecture',
  description: 'Architecture planning: requirement specs into software design specifications',
  router: architectureRouter,
};
