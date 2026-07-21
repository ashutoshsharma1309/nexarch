/**
 * AI Orchestrator & Prompt Intelligence Engine (Phase 9).
 *
 * The single entry point for every AI interaction in NexArch — no other
 * module calls a model provider directly. Manages prompt templates,
 * provider-agnostic model routing, context scoping (never the whole
 * project — only what a dependency-graph impact analysis marked
 * affected), prompt compression, response caching, retries with
 * exponential backoff, response validation, workflow execution, and
 * generation history. Generates no application code of its own — no
 * backend CRUD, no frontend pages, no schema. Public surface: this module
 * definition only.
 *
 * Supersedes the Phase 1 `generation` scaffold, the same way
 * `database-designer` supersedes the Phase 1 `database` scaffold.
 */
import type { AppModule } from '../../shared/types/module.js';
import { aiOrchestratorRouter } from './ai-orchestrator.router.js';

export const aiOrchestratorModule: AppModule = {
  name: 'ai-orchestrator',
  basePath: '/ai',
  description:
    'Centralized, provider-agnostic AI orchestration: prompts, routing, caching, retries, workflows',
  router: aiOrchestratorRouter,
};
