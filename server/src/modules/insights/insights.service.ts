/**
 * Insights service — composes the `lib/` writers into the full analysis
 * bundle. Stateless and pure: the same artifacts always produce the same
 * analysis (modulo the timestamp), the same contract every generator
 * module honors.
 */
import { buildDiagrams } from './lib/diagram-generator.js';
import { buildJustifications } from './lib/justification-engine.js';
import {
  explainApi,
  explainDatabase,
  explainFolders,
  explainSecurity,
  writeSummary,
} from './lib/narrative-writer.js';
import { buildScores } from './lib/score-engine.js';
import type { GenerateInsightsRequest, InsightsBundle } from './insights.types.js';

export function generateInsights(request: GenerateInsightsRequest): InsightsBundle {
  const { artifacts } = request;
  const { requirements, architecture, databaseDesign } = artifacts;

  return {
    meta: {
      projectName: architecture.meta.projectName,
      projectType: architecture.meta.projectType,
      generatedAt: new Date().toISOString(),
      generator: 'nexarch-insights-engine@1.0.0',
    },
    summary: writeSummary(requirements, architecture, databaseDesign),
    technologyJustifications: buildJustifications(requirements, architecture),
    explanations: {
      folders: explainFolders(architecture),
      database: explainDatabase(databaseDesign),
      api: explainApi(architecture),
      security: explainSecurity(architecture),
    },
    diagrams: buildDiagrams(architecture, databaseDesign),
    scores: buildScores(artifacts),
  };
}
