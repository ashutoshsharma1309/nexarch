/**
 * Insights service tests (`npm test`). Artifacts come from driving the real
 * pipeline (analyze → plan → design) — the same integration-guard pattern
 * every generator-consuming module's tests use — so the analysis is checked
 * against real planner decisions, not hand-shaped fixtures.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { analyzeRequirements } from '../analysis/analysis.service.js';
import { planArchitecture } from '../architecture/architecture.service.js';
import { designDatabase } from '../database-designer/database-designer.service.js';
import { generateInsights } from './insights.service.js';
import type { InsightsArtifacts } from './insights.types.js';

function buildArtifacts(prompt: string): InsightsArtifacts {
  const analysis = analyzeRequirements(prompt);
  if (analysis.status !== 'COMPLETE') assert.fail(`expected COMPLETE analysis for: ${prompt}`);
  const { plan } = planArchitecture(analysis.spec);
  const design = designDatabase(plan, analysis.spec);
  return {
    projectName: plan.meta.projectName,
    requirements: analysis.spec,
    architecture: plan,
    databaseDesign: design.databaseDesign,
  };
}

const artifacts = buildArtifacts(
  'Build an online learning platform where students enroll in courses, watch lessons, take quizzes and receive certificates, with instructor dashboards and payments',
);
const bundle = generateInsights({ artifacts });

describe('insights summary and explanations', () => {
  it('writes a summary quoting real counts from the plan and design', () => {
    assert.match(bundle.summary, new RegExp(String(artifacts.architecture.apiModules.length)));
    assert.match(bundle.summary, new RegExp(String(artifacts.databaseDesign.tables.length)));
    assert.match(bundle.summary, /Architecture Summary/);
  });

  it('explains every table and every API module by name', () => {
    for (const table of artifacts.databaseDesign.tables) {
      assert.match(bundle.explanations.database, new RegExp(table.entity));
    }
    for (const module of artifacts.architecture.apiModules) {
      assert.match(bundle.explanations.api, new RegExp(module.module));
    }
  });

  it('covers folders and the security posture', () => {
    assert.match(bundle.explanations.folders, /feature-first/);
    assert.match(
      bundle.explanations.security,
      new RegExp(artifacts.architecture.security.sessionStrategy.slice(0, 12)),
    );
  });
});

describe('technology justifications', () => {
  it('answers the core "why" questions from the planner’s recorded decisions', () => {
    const questions = bundle.technologyJustifications.map((j) => j.question);
    assert.ok(questions.some((q) => q.startsWith('Why this architecture')));
    assert.ok(questions.some((q) => q.includes(artifacts.architecture.database.engine)));
    assert.ok(questions.some((q) => q === 'Why Docker?'));
    // Reasoning is quoted from the plan, never empty.
    for (const justification of bundle.technologyJustifications) {
      assert.ok(justification.reasoning.length > 20, `${justification.question} lacks reasoning`);
    }
  });
});

describe('diagrams', () => {
  it('emits valid-looking mermaid for architecture, ER, and API flow', () => {
    assert.match(bundle.diagrams.architecture.mermaid, /^flowchart LR/);
    assert.match(bundle.diagrams.er.mermaid, /^erDiagram/);
    assert.match(bundle.diagrams.apiFlow.mermaid, /^sequenceDiagram/);
  });

  it('draws every table of the design in the ER diagram', () => {
    for (const table of artifacts.databaseDesign.tables) {
      assert.match(
        bundle.diagrams.er.mermaid,
        new RegExp(table.entity.replace(/[^a-zA-Z0-9]/g, '_')),
      );
    }
  });
});

describe('scores', () => {
  it('scores all four dimensions in range with explained reasoning', () => {
    for (const score of [
      bundle.scores.maintainability,
      bundle.scores.security,
      bundle.scores.scalability,
      bundle.scores.overall,
    ]) {
      assert.ok(score.score >= 0 && score.score <= 100);
      assert.ok(score.reasoning.length > 0, 'a score without a why is a number');
      assert.ok(['A+', 'A', 'B', 'C', 'D', 'F'].includes(score.grade));
    }
  });

  it('blends a supplied quality report into the overall score', () => {
    const withQuality = generateInsights({
      artifacts: { ...artifacts, quality: { overallScore: 100, grade: 'A' } },
    });
    assert.ok(withQuality.scores.overall.score >= bundle.scores.overall.score);
    assert.ok(withQuality.scores.overall.reasoning.some((line) => line.includes('Quality Engine')));
  });
});
