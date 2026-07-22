/**
 * Developer Workspace, Project Management & Export Engine (Phase 10).
 *
 * Project CRUD, project-level generation history, a workspace activity
 * feed, documentation generation, and the export engine — the backend for
 * the console shell every other phase's Explorer pages live inside.
 * Projects are in-memory (see `lib/project-store.ts` for why: no auth
 * module exists yet to supply the required `ownerId` a real Prisma
 * `Project` row needs). Documentation and export are pure functions of
 * whatever pipeline artifacts the client sends — this module never reaches
 * into another module's in-memory state. Generates nothing for the
 * end-user's application itself: no backend CRUD, no frontend pages, no
 * schema — those are Phases 5-7's job. Public surface: this module
 * definition only.
 */
import type { AppModule } from '../../shared/types/module.js';
import { workspaceRouter } from './workspace.router.js';

export const workspaceModule: AppModule = {
  name: 'workspace',
  basePath: '/',
  description: 'Project management, generation history, documentation, and the export engine',
  router: workspaceRouter,
};
