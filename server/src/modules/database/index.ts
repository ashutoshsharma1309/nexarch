/**
 * Database-design module — scaffold.
 *
 * Future home of schema design for *generated* applications: entity
 * modeling, relation inference, and Prisma schema emission for user
 * projects. Distinct from `src/shared/database`, which is NexArch's own
 * connection layer — this module designs databases for other apps.
 */
import type { AppModule } from '../../shared/types/module.js';
import { createScaffoldRouter } from '../../shared/utils/module-scaffold.js';

export const databaseModule: AppModule = {
  name: 'database',
  basePath: '/database',
  description: 'Schema design and migration planning for generated applications',
  router: createScaffoldRouter({
    module: 'database',
    summary: 'Schema design and migration planning for generated applications',
    plannedPhase: 2,
    capabilities: ['design-schema', 'emit-prisma-schema', 'plan-migrations'],
    status: 'scaffold',
  }),
};
