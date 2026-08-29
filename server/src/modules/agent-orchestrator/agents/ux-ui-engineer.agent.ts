/**
 * UX/UI Engineer — the agent that asks whether any of this is usable.
 *
 * It is not a second frontend generator, and the split of work inside it
 * is what keeps it from becoming one.
 *
 * Everything measurable is measured, in code: whether a form labels its
 * fields, whether a failed request is visible, whether a layout has any
 * small-screen behaviour at all. Those answers are in the files. Asking a
 * model to guess at them would cost tokens to get a less reliable result,
 * and the finding would carry an air of judgement about something that is
 * simply a fact.
 *
 * The model is asked only what code cannot decide — whether the screens
 * add up to a product, whether a journey survives contact with them,
 * whether the prominent action is the important one. Its findings are
 * marked `observed: false`, because a reader is owed the difference
 * between a measurement and an opinion.
 *
 * Improvements are then applied from the *checked* findings only, never
 * from the model's. A targeted edit needs an exact pattern to match; an
 * opinion has none, which is precisely why acting on one would mean
 * rewriting the file and calling it an improvement.
 */
import { generateWithContext } from '../../ai-orchestrator/ai-orchestrator.service.js';
import { getAgentDefinition } from '../../../shared/contracts/index.js';
import { logger } from '../../../shared/logger/index.js';
import { AgentError } from '../lib/executor.js';
import { passedCategories, runUxChecks } from '../lib/ux-checks.js';
import { applyUxImprovements } from '../lib/ux-improvements.js';
import type {
  Agent,
  AgentExecutionInput,
  AgentFinding,
  AgentResult,
} from '../../../shared/contracts/index.js';
import type { ProductSpec } from '../../../shared/types/product.js';
import type { RequirementSpec } from '../../../shared/types/requirement.js';
import type {
  UxCategory,
  UxFinding,
  UxImprovementSet,
  UxReview,
  UxSeverity,
} from '../../../shared/types/generation.js';

const definition = getAgentDefinition('ux-ui-engineer');
if (!definition) throw new Error('ux-ui-engineer is not declared');

interface SourceArtifact {
  files: { path: string; content: string }[];
}

interface FrontendMetadata {
  pages?: { name: string; route: string; implemented: boolean }[];
}

const SEVERITIES = new Set<UxSeverity>(['HIGH', 'MEDIUM', 'LOW']);
const MODEL_CATEGORIES = new Set<UxCategory>([
  'HIERARCHY',
  'NAVIGATION',
  'LAYOUT',
  'INTERACTION',
  'JOURNEY',
]);

/**
 * Keeps only what the model was actually asked for.
 *
 * A model told to name a real screen will occasionally invent one, and a
 * finding pointing at a screen that does not exist is worse than no
 * finding: it sends a reader looking for a file that was never generated.
 */
function acceptModelFindings(raw: unknown, screens: readonly string[]): UxFinding[] {
  const parsed = raw as { findings?: unknown };
  if (!Array.isArray(parsed.findings)) return [];

  const known = new Set(screens.map((screen) => screen.toLowerCase()));
  const findings: UxFinding[] = [];

  for (const entry of parsed.findings.slice(0, 12)) {
    if (typeof entry !== 'object' || entry === null) continue;
    const item = entry as Record<string, unknown>;

    const severity = (
      typeof item.severity === 'string' ? item.severity : ''
    ).toUpperCase() as UxSeverity;
    const category = (
      typeof item.category === 'string' ? item.category : ''
    ).toUpperCase() as UxCategory;
    const target = typeof item.target === 'string' ? item.target.trim() : '';
    const issue = typeof item.issue === 'string' ? item.issue.trim() : '';
    const recommendation =
      typeof item.recommendation === 'string' ? item.recommendation.trim() : '';

    if (!SEVERITIES.has(severity) || !MODEL_CATEGORIES.has(category)) continue;
    if (issue === '' || recommendation === '') continue;
    if (!known.has(target.toLowerCase())) continue;

    findings.push({
      severity,
      category,
      target,
      file: null,
      issue,
      recommendation,
      observed: false,
    });
  }

  return findings;
}

/** The agent's findings, which are the run-level view of the review. */
function toAgentFindings(findings: readonly UxFinding[]): AgentFinding[] {
  return findings.map((finding) => ({
    severity: finding.severity,
    category: `UX_${finding.category}`,
    title: `${finding.target}: ${finding.issue}`,
    description: `${finding.recommendation}${finding.file ? ` (${finding.file})` : ''}`,
    targetNodeId: null,
    status: 'OPEN' as const,
  }));
}

export const uxUiEngineerAgent: Agent<{ review: UxReview; improvements: UxImprovementSet }> = {
  definition,

  async execute(
    input: AgentExecutionInput,
  ): Promise<AgentResult<{ review: UxReview; improvements: UxImprovementSet }>> {
    const startedAt = Date.now();

    const requirements = input.inputArtifacts['requirement-spec'] as RequirementSpec | undefined;
    const product = input.inputArtifacts['product-spec'] as ProductSpec | undefined;
    const source = input.inputArtifacts['frontend-source'] as SourceArtifact | undefined;
    const metadata = input.inputArtifacts['frontend-metadata'] as FrontendMetadata | undefined;

    if (!requirements || !source?.files) {
      throw new AgentError(
        'invalid-input',
        'The UX engineer requires the requirement spec and the generated frontend',
      );
    }

    /* ── Measured ─────────────────────────────────────────────────────── */

    const checked = runUxChecks(source.files, product);
    const screens = (metadata?.pages ?? []).map((page) => page.name);

    /* ── Judged ───────────────────────────────────────────────────────── */

    let modelFindings: UxFinding[] = [];
    let usage: AgentResult['usage'] = null;
    let degraded = false;
    let note: string | null = null;

    try {
      const response = await generateWithContext(
        input.context ?? { text: '', budget: { maxOutputTokens: 2048 } },
        {
          promptId: 'ux-reviewer',
          complexity: 'simple-extraction',
          schema: 'generic-json',
          variables: {
            PROJECT_NAME: requirements.projectName,
            PROJECT_TYPE: requirements.projectType,
            PRODUCT_SUMMARY: product?.summary ?? `A ${requirements.projectType} application.`,
            JOURNEYS:
              (product?.journeys ?? [])
                .map(
                  (journey) => `- ${journey.name} (${journey.actor}): ${journey.steps.join(' → ')}`,
                )
                .join('\n') || 'None stated.',
            SCREENS: screens.map((screen) => `- ${screen}`).join('\n') || 'None.',
            KNOWN_FINDINGS:
              checked
                .slice(0, 12)
                .map((finding) => `- [${finding.category}] ${finding.target}: ${finding.issue}`)
                .join('\n') || 'None.',
          },
        },
      );

      modelFindings = acceptModelFindings(JSON.parse(response.content), screens);
      usage = {
        provider: response.record.provider,
        model: response.record.model,
        inputTokens: response.record.tokens.inputTokens,
        outputTokens: response.record.tokens.outputTokens,
        costUsd: response.record.cost.totalCostUsd,
        contextTokens: input.context?.tokens ?? 0,
      };
    } catch (error) {
      // The measured half of the review is the half that finds real
      // defects. Losing the model's judgement degrades the review; it does
      // not invalidate it, and it must not fail the run.
      logger.warn('ux reviewer ran without its model pass', { error });
      degraded = true;
      note =
        'The model was unavailable; this review reports only what the automated checks observed.';
    }

    const findings = [...checked, ...modelFindings];

    /* ── Improved ─────────────────────────────────────────────────────── */

    const { files, set } = applyUxImprovements(source.files);

    const review: UxReview = {
      projectName: requirements.projectName,
      reviewedFiles: source.files.length,
      reviewedScreens: screens.length,
      findings,
      passed: passedCategories(checked),
      degraded,
      note,
    };

    const agentFindings = toAgentFindings(findings);
    if (degraded) {
      agentFindings.push({
        severity: 'LOW',
        category: 'RELIABILITY',
        title: 'UX review ran without its model pass',
        description: note ?? 'The model was unavailable.',
        targetNodeId: null,
        status: 'OPEN',
      });
    }

    return {
      agentId: 'ux-ui-engineer',
      status: 'succeeded',
      output: { review, improvements: set },
      artifacts: {
        'ux-review': review,
        'ux-improvements': set,
        // The improved frontend replaces the reviewed one, so the runner
        // and the preview get the version the review produced rather than
        // the version it criticized.
        'frontend-source': { ...source, files },
      },
      findings: agentFindings,
      error: null,
      failureKind: null,
      durationMs: Date.now() - startedAt,
      usage,
    };
  },
};
