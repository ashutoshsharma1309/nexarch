/**
 * Generation module — scaffold.
 *
 * Phase 2's core: accepts a natural-language prompt, orchestrates the
 * pipeline (analyze → plan → generate → review), streams progress, and
 * persists runs to the `generations` table already present in the schema.
 * The AI provider integration lives behind this module's service layer so
 * swapping or multi-homing model vendors never touches routes.
 */
import type { AppModule } from '../../shared/types/module.js';
import { createScaffoldRouter } from '../../shared/utils/module-scaffold.js';

export const generationModule: AppModule = {
  name: 'generation',
  basePath: '/generations',
  description: 'Prompt intake and generation pipeline orchestration',
  router: createScaffoldRouter({
    module: 'generation',
    summary: 'Prompt intake and generation pipeline orchestration',
    plannedPhase: 2,
    capabilities: ['create-run', 'stream-progress', 'list-runs', 'resume-failed'],
    status: 'scaffold',
  }),
};
