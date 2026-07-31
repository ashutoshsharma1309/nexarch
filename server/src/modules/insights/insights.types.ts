/**
 * Contracts for the AI Architecture Analysis Engine (Phase 13).
 *
 * After a project is generated, this module turns the pipeline's structured
 * artifacts into the narrative a reviewing engineer would write: what the
 * architecture is, why each technology was chosen, how the folders/database/
 * API fit together, plus diagrams and engineering scores. It generates
 * nothing new — every sentence is derived from decisions the upstream
 * planners already recorded, which is what keeps the analysis honest.
 */
import type { ArchitecturePlan } from '../../shared/types/architecture.js';
import type { DatabaseDesign } from '../../shared/types/design.js';
import type { RequirementSpec } from '../../shared/types/requirement.js';

/* ── Input ────────────────────────────────────────────────────────────── */

/**
 * Duck-typed pipeline output, same convention as Deployment/Quality: the
 * three structured stages are required (there is nothing to analyze without
 * them), everything later is optional enrichment.
 */
export interface InsightsArtifacts {
  projectName: string;
  requirements: RequirementSpec;
  architecture: ArchitecturePlan;
  databaseDesign: DatabaseDesign;
  /** Optional Phase 12 result — folded into the overall score when present. */
  quality?: { overallScore: number; grade: string } | undefined;
}

export interface GenerateInsightsRequest {
  artifacts: InsightsArtifacts;
}

/* ── Technology justifications ────────────────────────────────────────── */

export interface TechnologyJustification {
  /** The question a reviewer would ask, e.g. "Why MySQL?". */
  question: string;
  technology: string;
  /** Layer the choice belongs to: frontend, backend, database, auth, infra. */
  layer: 'frontend' | 'backend' | 'database' | 'authentication' | 'infrastructure';
  reasoning: string;
  alternatives: { option: string; rejectedBecause: string }[];
}

/* ── Diagrams ─────────────────────────────────────────────────────────── */

export interface InsightsDiagram {
  title: string;
  /** Mermaid source — the client renders it; nothing here draws pixels. */
  mermaid: string;
}

export interface InsightsDiagrams {
  architecture: InsightsDiagram;
  er: InsightsDiagram;
  apiFlow: InsightsDiagram;
}

/* ── Scores ───────────────────────────────────────────────────────────── */

export interface InsightScore {
  /** 0-100. */
  score: number;
  grade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
  /** Every point deduction is explained — a score without a why is a number. */
  reasoning: string[];
}

export interface InsightsScores {
  maintainability: InsightScore;
  security: InsightScore;
  scalability: InsightScore;
  overall: InsightScore;
}

/* ── The assembled analysis ───────────────────────────────────────────── */

export interface InsightsBundle {
  meta: {
    projectName: string;
    projectType: string;
    generatedAt: string;
    generator: string;
  };
  /** Executive architecture summary, markdown. */
  summary: string;
  technologyJustifications: TechnologyJustification[];
  /** Markdown explanations, one per structural concern. */
  explanations: {
    folders: string;
    database: string;
    api: string;
    security: string;
  };
  diagrams: InsightsDiagrams;
  scores: InsightsScores;
}
