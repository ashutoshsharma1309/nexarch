/**
 * Engineering Graph module — the project's structured knowledge.
 *
 * Mounted at `/projects` so its routes read `/projects/:projectId/graph`,
 * matching the project-centric shape the rest of v2 uses. The workspace
 * module owns `/projects` and `/project/:id`; this owns the `graph`
 * subtree beneath a project id, and the two never collide because their
 * paths diverge at the segment after the id.
 *
 * `synchronize` is the module's other public surface: the pipeline calls
 * it when a run finishes, so the graph is never something a user has to
 * remember to refresh.
 */
import type { AppModule } from '../../shared/types/module.js';
import { engineeringGraphRouter } from './engineering-graph.router.js';

export { synchronize } from './engineering-graph.service.js';

export const engineeringGraphModule: AppModule = {
  name: 'engineering-graph',
  basePath: '/projects',
  description: 'Project knowledge graph: nodes, relationships, traversal, impact analysis',
  router: engineeringGraphRouter,
};
