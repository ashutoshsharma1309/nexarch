/**
 * The two stages that actually call a model, and the rule that governs
 * both: the model supplies *semantics* (what this domain is, what its
 * entities are, what columns they carry) and deterministic code supplies
 * *structure* (the plan, the schema, the files). Anything code can derive
 * correctly is derived by code — that is what keeps a run to two bounded
 * calls instead of eight open-ended ones.
 *
 * Both helpers degrade rather than fail: with no key configured, or a
 * provider that is down, the run continues on the deterministic analyzer
 * and the rule-table field hints, and the stage reports itself `degraded`
 * so the UI can say so instead of pretending.
 */
import { analyzeRequirements } from '../../analysis/analysis.service.js';
import { generate } from '../../ai-orchestrator/ai-orchestrator.service.js';
import { resolveProvider } from '../../ai-orchestrator/lib/providers/provider-registry.js';
import { logger } from '../../../shared/logger/index.js';
import type { EntityPlan } from '../../../shared/types/architecture.js';
import type { RequirementSpec } from '../../../shared/types/requirement.js';
import { normalizeSpec, toEntityName } from './spec-normalizer.js';

export interface AiCallStat {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface StageOutcome<T> {
  value: T;
  degraded: boolean;
  /** Why the stage degraded — surfaced to the user as a note, not an error. */
  note: string | null;
  usage: AiCallStat | null;
}

/** True when some real provider (i.e. not the always-available mock) can serve a call. */
export function aiConfigured(): boolean {
  return resolveProvider('groq', 'claude').id !== 'mock';
}

function parseJson(text: string): unknown {
  return JSON.parse(text) as unknown;
}

/** Short, stable project name derived from the prompt — used before the model has named anything. */
export function deriveProjectName(prompt: string): string {
  const words = prompt
    .replace(/[^A-Za-z0-9 ]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(
      (word) => word.length > 2 && !/^(build|create|make|with|that|the|and|for|app)$/i.test(word),
    )
    .slice(0, 3);
  const name = words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
  return name.length >= 3 ? name : 'Generated App';
}

/* ── Stage 1: requirement analysis ────────────────────────────────────── */

/**
 * The deterministic analyzer answers "is this prompt even complete?" and
 * knows a curated set of domains. The model handles everything it doesn't —
 * which is most real prompts — so the model runs first and the analyzer is
 * the safety net, not the other way round.
 */
export async function analyzeWithAi(
  prompt: string,
  projectName: string,
): Promise<StageOutcome<RequirementSpec>> {
  if (aiConfigured()) {
    try {
      const response = await generate({
        promptId: 'requirement-analyzer',
        variables: { PROJECT_NAME: projectName, USER_REQUEST: prompt },
        complexity: 'simple-extraction',
        schema: 'requirement-spec',
      });
      return {
        value: normalizeSpec(parseJson(response.content), { projectName }),
        degraded: false,
        note: null,
        usage: {
          provider: response.record.provider,
          model: response.record.model,
          inputTokens: response.record.tokens.inputTokens,
          outputTokens: response.record.tokens.outputTokens,
          costUsd: response.record.cost.totalCostUsd,
        },
      };
    } catch (error) {
      logger.warn('requirement analysis fell back to the deterministic analyzer', {
        reason: error instanceof Error ? error.message : String(error),
      });
      return { ...deterministicSpec(prompt, projectName), note: aiUnavailableNote(error) };
    }
  }

  return {
    ...deterministicSpec(prompt, projectName),
    note: 'No AI provider configured — analyzed with the built-in rule-based analyzer.',
  };
}

function deterministicSpec(
  prompt: string,
  projectName: string,
): Omit<StageOutcome<RequirementSpec>, 'note'> {
  const result = analyzeRequirements(prompt);
  if (result.status === 'COMPLETE') {
    return { value: { ...result.spec, projectName }, degraded: true, usage: null };
  }

  // The prompt was too thin for the rule-based analyzer to profile. Build the
  // minimum viable spec from what it did detect rather than dead-ending the
  // run: a generated CRUD app the user can then refine beats a blank screen.
  const detected = result.detection.matchedSignals
    .map((signal) => toEntityName(signal))
    .filter((name): name is string => name !== null);
  const entities = [...new Set(['Users', ...detected])].slice(0, 8);

  return {
    value: {
      projectName,
      projectType: result.detection.projectType ?? 'custom',
      roles: ['Admin', 'User'],
      modules: ['Authentication', 'Core Management'],
      frontend: ['Dashboard'],
      backend: ['REST API'],
      database: entities,
      authentication: ['Email and password', 'JWT sessions'],
      integrations: [],
      missingRequirements: result.questions,
    },
    degraded: true,
    usage: null,
  };
}

/* ── Stage 2: entity column design ────────────────────────────────────── */

interface AiEntityFields {
  entities?: { name?: unknown; fields?: unknown }[];
}

const RESERVED_FIELDS = new Set(['id', 'created_at', 'updated_at', 'deleted_at']);

/** Entities whose columns are dictated by the generated auth module, not the domain. */
const AUTH_OWNED_ENTITIES = new Set(['Users']);
const FIELD_PATTERN = /^([a-z][a-z0-9_]{1,38})(\s*\(unique\))?$/;

/**
 * Ask the model for business columns, then merge them into the plan's
 * entities. The merge is deliberately conservative: unknown entity names
 * are dropped, foreign keys and audit columns are stripped (the designer
 * owns those), and an entity the model skipped keeps whatever the rule
 * table already gave it. A bad answer can only fail to improve the plan —
 * it can never corrupt it.
 */
export async function designEntityFields(
  entities: EntityPlan[],
  context: { projectName: string; projectType: string },
): Promise<StageOutcome<EntityPlan[]>> {
  if (!aiConfigured() || entities.length === 0) {
    return {
      value: entities,
      degraded: true,
      note: aiConfigured() ? null : 'No AI provider configured — used built-in field conventions.',
      usage: null,
    };
  }

  // `Users` is not an ordinary domain entity: the Security Engine generates a
  // registration endpoint and a Register screen against it with a fixed
  // contract (name, email, password). Any extra non-null column the model
  // invents there becomes a required field the generated form never collects,
  // and signup in the generated app breaks. Its columns come from the auth
  // contract, so it is excluded from field design entirely.
  const designable = entities.filter((entity) => !AUTH_OWNED_ENTITIES.has(entity.name));
  if (designable.length === 0) {
    return { value: entities, degraded: false, note: null, usage: null };
  }

  // Only the entity names go over the wire — not the plan, not the prompt,
  // not the upstream spec. The model needs nothing else to name columns.
  const entityList = designable.map((entity) => `- ${entity.name}`).join('\n');

  try {
    const response = await generate({
      promptId: 'entity-fields',
      variables: {
        PROJECT_NAME: context.projectName,
        PROJECT_TYPE: context.projectType,
        ENTITIES: entityList,
      },
      complexity: 'simple-extraction',
      schema: 'generic-json',
    });

    const parsed = parseJson(response.content) as AiEntityFields;
    const byName = new Map<string, string[]>();
    for (const entry of parsed.entities ?? []) {
      if (typeof entry.name !== 'string' || !Array.isArray(entry.fields)) continue;
      const fields = entry.fields
        .filter((field): field is string => typeof field === 'string')
        .map((field) => field.trim().toLowerCase())
        .filter((field) => FIELD_PATTERN.test(field))
        .filter((field) => {
          const bare = field.replace(/\s*\(unique\)$/, '');
          return !RESERVED_FIELDS.has(bare) && !bare.endsWith('_id');
        })
        .slice(0, 8);
      if (fields.length > 0) byName.set(entry.name.trim(), fields);
    }

    const merged = entities.map((entity) => {
      const aiFields = byName.get(entity.name);
      if (!aiFields) return entity;

      // keyFields is an ordered contract: id, business columns, foreign
      // keys, audit columns. Rebuild it in that order with the model's
      // columns in the business slot, keeping anything the rule table
      // already knew that the model didn't repeat.
      const foreignKeys = entity.relations.map((relation) => relation.foreignKey);
      const existingBusiness = entity.keyFields.filter(
        (field) => !RESERVED_FIELDS.has(field) && !foreignKeys.includes(field) && field !== 'id',
      );
      const business = [...new Set([...aiFields, ...existingBusiness])].slice(0, 9);

      return {
        ...entity,
        keyFields: ['id', ...business, ...foreignKeys, 'created_at', 'updated_at'],
      };
    });

    return {
      value: merged,
      degraded: false,
      note: null,
      usage: {
        provider: response.record.provider,
        model: response.record.model,
        inputTokens: response.record.tokens.inputTokens,
        outputTokens: response.record.tokens.outputTokens,
        costUsd: response.record.cost.totalCostUsd,
      },
    };
  } catch (error) {
    logger.warn('entity field design fell back to built-in conventions', {
      reason: error instanceof Error ? error.message : String(error),
    });
    return { value: entities, degraded: true, note: aiUnavailableNote(error), usage: null };
  }
}

/** Turns a provider failure into something a user can act on, without leaking internals. */
export function aiUnavailableNote(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/401|invalid api key/i.test(message)) {
    return 'The AI provider rejected the configured key — continued with built-in rules.';
  }
  if (/429|rate limit/i.test(message)) {
    return 'The AI provider is rate limiting this key — continued with built-in rules.';
  }
  if (/timed out|timeout/i.test(message)) {
    return 'The AI provider timed out — continued with built-in rules.';
  }
  return 'The AI provider was unreachable — continued with built-in rules.';
}
