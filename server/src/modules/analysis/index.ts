/**
 * Requirement Analysis module — the first implemented stage of the
 * generation pipeline. Transforms natural-language prompts into structured
 * RequirementSpec JSON (or clarifying questions), ready for the
 * Architecture Planner. Public surface: this module definition only.
 */
import type { AppModule } from '../../shared/types/module.js';
import { analysisRouter } from './analysis.router.js';

export const analysisModule: AppModule = {
  name: 'analysis',
  basePath: '/analyze',
  description: 'Natural-language requirement analysis producing structured specifications',
  router: analysisRouter,
};
