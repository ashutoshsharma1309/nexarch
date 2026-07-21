/**
 * Dependency Graph & Incremental Regeneration Engine (Phase 8).
 *
 * Scans the backend, frontend, and security bundles Phases 5-7 produced,
 * builds a directed graph of how every page, component, route, controller,
 * service, repository, table, and config value depends on the others, and
 * uses that graph to answer "what does this change touch?" cheaply — so a
 * future AI Orchestrator only needs to send an LLM the files a change
 * actually affects, not the whole project. Generates nothing on its own:
 * no backend CRUD, no frontend pages, no auth, no schema — it reads what
 * exists and plans/merges around it. Public surface: this module
 * definition only.
 */
import type { AppModule } from '../../shared/types/module.js';
import { dependencyGraphRouter } from './dependency-graph.router.js';

export const dependencyGraphModule: AppModule = {
  name: 'dependency-graph',
  basePath: '/dependency',
  description:
    'Builds the project dependency graph and scopes regeneration to only the affected files',
  router: dependencyGraphRouter,
};
