/**
 * AI Architecture Analysis Engine (Phase 13).
 *
 * Turns the pipeline's structured artifacts into the review a senior
 * engineer would write after reading the whole design: an executive
 * summary, "why this technology?" justifications quoting the planner's own
 * recorded decisions, folder/database/API/security explanations, Mermaid
 * architecture/ER/API-flow diagrams, and maintainability/security/
 * scalability scores where every point is explained. Derives everything
 * from upstream artifacts — it invents nothing, which is what keeps the
 * analysis trustworthy. Public surface: this module definition only.
 */
import type { AppModule } from '../../shared/types/module.js';
import { insightsRouter } from './insights.router.js';

export const insightsModule: AppModule = {
  name: 'insights',
  basePath: '/insights',
  description:
    'Automatic architecture analysis: summaries, technology justifications, diagrams, and scores',
  router: insightsRouter,
};
