/**
 * Decides what to research for this product and how much of it to pay for.
 *
 * The questions come from a model because they have to differ by domain: a cafe
 * and a dashboard share almost nothing worth searching for. With no model the
 * plan is derived from the spec and kept deliberately small, since a generic
 * plan is not worth much search quota.
 */
import { z } from 'zod';

import type { generate } from '../../ai-orchestrator/ai-orchestrator.service.js';
import type { RequirementSpec } from '../../../shared/types/requirement.js';
import type { ResearchDepth, ResearchModelCall } from '../web-research.types.js';
import { normalizeQuery } from './research-cache.js';
import {
  BUDGET_MARGIN_MS,
  modelCallFailure,
  modelCallFromRecord,
  withTimeout,
} from './model-calls.js';

/** Hard limits per run. A plan, a depth or an override can only go below these. */
export const MAX_SEARCHES_PER_RUN = 10;
export const MAX_EXTRACTIONS_PER_RUN = 8;

const MAX_QUERY_CHARS = 180;
const PLANNER_TIMEOUT_MS = 45_000;

/** Modules, roles and integrations at or above this score get deep research. */
const DEEP_RESEARCH_SCORE = 10;

export interface ResearchBudget {
  depth: ResearchDepth;
  maxQuestions: number;
  discoveryQueries: number;
  researchQueries: number;
  extractions: number;
  maxSources: number;
  maxEvidenceChars: number;
}

const BUDGETS: Record<ResearchDepth, ResearchBudget> = {
  standard: {
    depth: 'standard',
    maxQuestions: 5,
    discoveryQueries: 2,
    researchQueries: 3,
    extractions: 4,
    maxSources: 16,
    maxEvidenceChars: 18_000,
  },
  deep: {
    depth: 'deep',
    maxQuestions: 8,
    discoveryQueries: 3,
    researchQueries: 5,
    extractions: MAX_EXTRACTIONS_PER_RUN,
    maxSources: 26,
    maxEvidenceChars: 30_000,
  },
};

export interface ResearchPlan {
  objective: string;
  domainLabel: string;
  questions: string[];
  discoveryQueries: string[];
  researchQueries: string[];
  degraded: boolean;
}

export interface PlanOutcome {
  plan: ResearchPlan;
  limitation: string | null;
  modelCall: ResearchModelCall | null;
}

export interface PlannerInput {
  prompt: string;
  spec: RequirementSpec;
}

/** Integrations weigh double: each one is a separate system with its own conventions. */
export function chooseBudget(spec: RequirementSpec): ResearchBudget {
  const score = spec.modules.length + spec.roles.length + spec.integrations.length * 2;
  return BUDGETS[score >= DEEP_RESEARCH_SCORE ? 'deep' : 'standard'];
}

function cleanQuery(query: string): string {
  return query.replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY_CHARS).trim();
}

/** One query per distinct normalised form across both lists, so nothing is billed twice. */
function limitQueries(
  discovery: readonly string[],
  research: readonly string[],
  budget: { discoveryQueries: number; researchQueries: number },
): { discoveryQueries: string[]; researchQueries: string[] } {
  const seen = new Set<string>();
  const take = (queries: readonly string[], limit: number): string[] => {
    const kept: string[] = [];
    for (const raw of queries) {
      const query = cleanQuery(raw);
      const key = normalizeQuery(query);
      if (key.length < 3 || seen.has(key)) continue;
      seen.add(key);
      kept.push(query);
      if (kept.length === limit) break;
    }
    return kept;
  };
  const discoveryQueries = take(discovery, budget.discoveryQueries);
  const researchQueries = take(research, budget.researchQueries);
  return { discoveryQueries, researchQueries };
}

export function domainLabelOf(spec: RequirementSpec): string {
  const label = spec.projectType.replace(/[-_]+/g, ' ').trim();
  return label === '' ? 'web application' : label.slice(0, 80);
}

export function fallbackObjective(input: PlannerInput): string {
  return `Establish how real ${domainLabelOf(input.spec)} products are designed and built, to inform this request.`;
}

/** The plan used when no model can write one. It asks less because it knows less. */
export function deriveFallbackPlan(input: PlannerInput): ResearchPlan {
  const domain = domainLabelOf(input.spec);
  const modules = input.spec.modules.slice(0, 2);
  const queries = limitQueries(
    [`best ${domain} website examples`, `${domain} website design inspiration`],
    modules.length > 0
      ? modules.map((module) => `${domain} ${module} UX best practices`)
      : [`${domain} website UX best practices`],
    { discoveryQueries: 2, researchQueries: 2 },
  );
  return {
    objective: fallbackObjective(input),
    domainLabel: domain,
    questions: [
      `What do well-regarded ${domain} products have in common?`,
      ...modules.map((module) => `How do ${domain} products usually handle ${module}?`),
    ],
    ...queries,
    degraded: true,
  };
}

// Items are judged one at a time below: gpt-oss-20b measurably appends a stray
// empty string, and one blank entry should not cost a good plan.
const modelPlan = z.object({
  objective: z.string().min(8).max(500),
  domainLabel: z.string().min(2).max(80),
  questions: z.array(z.string()),
  discoveryQueries: z.array(z.string()),
  researchQueries: z.array(z.string()),
});

const MIN_QUESTION_CHARS = 8;
const MAX_QUESTION_CHARS = 400;
const MIN_PLAN_QUESTIONS = 2;

function parseModelPlan(content: string, budget: ResearchBudget): ResearchPlan | null {
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    return null;
  }
  const parsed = modelPlan.safeParse(json);
  if (!parsed.success) return null;
  const queries = limitQueries(parsed.data.discoveryQueries, parsed.data.researchQueries, budget);
  if (queries.discoveryQueries.length + queries.researchQueries.length === 0) return null;
  const questions = parsed.data.questions
    .map((question) => question.trim())
    .filter((q) => q.length >= MIN_QUESTION_CHARS && q.length <= MAX_QUESTION_CHARS)
    .slice(0, budget.maxQuestions);
  if (questions.length < MIN_PLAN_QUESTIONS) return null;
  return {
    objective: parsed.data.objective.trim(),
    domainLabel: parsed.data.domainLabel.trim(),
    questions,
    ...queries,
    degraded: false,
  };
}

function listOrNone(items: readonly string[] | undefined): string {
  return items && items.length > 0 ? items.join(', ') : 'none stated';
}

export async function planResearch(
  input: PlannerInput,
  budget: ResearchBudget,
  generateFn: typeof generate,
): Promise<PlanOutcome> {
  const degraded = (reason: string, modelCall: ResearchModelCall | null): PlanOutcome => ({
    plan: deriveFallbackPlan(input),
    limitation: `Research planning was degraded (${reason}), so a smaller plan derived from the spec was used.`,
    modelCall,
  });

  const startedAt = Date.now();
  try {
    const response = await withTimeout(
      generateFn(
        {
          promptId: 'web-research-planner',
          // The fast tier measurably failed this schema on Groq, which degraded the
          // whole run to the small fallback plan. One deep call is cheap beside that.
          complexity: 'large-planning',
          schema: 'research-plan',
          variables: {
            USER_REQUEST: input.prompt,
            PROJECT_NAME: input.spec.projectName,
            PROJECT_TYPE: input.spec.projectType,
            GOAL: input.spec.goal ?? 'not stated',
            ROLES: listOrNone(input.spec.roles),
            MODULES: listOrNone(input.spec.modules),
            INTEGRATIONS: listOrNone(input.spec.integrations),
            MAX_QUESTIONS: String(budget.maxQuestions),
            MAX_DISCOVERY_QUERIES: String(budget.discoveryQueries),
            MAX_RESEARCH_QUERIES: String(budget.researchQueries),
          },
        },
        { timeBudgetMs: PLANNER_TIMEOUT_MS - BUDGET_MARGIN_MS },
      ),
      PLANNER_TIMEOUT_MS,
    );
    const modelCall = modelCallFromRecord('planning', response.record);
    // The mock answers anything; its echo is not a plan.
    if (response.record.provider === 'mock')
      return degraded('no AI model is configured', modelCall);
    const plan = parseModelPlan(response.content, budget);
    return plan
      ? { plan, limitation: null, modelCall }
      : degraded('the model returned an invalid plan', modelCall);
  } catch {
    return degraded('the planning model call failed', modelCallFailure('planning', startedAt));
  }
}
