/**
 * Turning model output into something the rest of the system can rely on.
 *
 * A model asked for JSON returns JSON, but not always the JSON you asked
 * for — a string where an array belongs, a missing key, an extra one. The
 * schema validator upstream catches a response that is not an object; this
 * catches everything between "parses" and "usable".
 *
 * The rule throughout: coerce what is recoverable, drop what is not, and
 * never invent content. A normalizer that fills in plausible modules would
 * hide exactly the failure the caller needs to see.
 */
import type { ProductModule, ProductSpec } from '../../../shared/types/product.js';
import type { RequirementSpec } from '../../../shared/types/requirement.js';

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
  }
  // A model sometimes answers a list with one comma-separated string.
  if (typeof value === 'string' && value.trim() !== '') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          typeof item === 'object' && item !== null && !Array.isArray(item),
      )
    : [];
}

export function normalizeProductSpec(raw: unknown, requirements: RequirementSpec): ProductSpec {
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;

  const modules: ProductModule[] = asRecordArray(source.modules)
    .map((module) => ({
      name: asString(module.name),
      purpose: asString(module.purpose, 'No purpose stated.'),
      owns: asStringArray(module.owns),
      dependsOn: asStringArray(module.dependsOn),
      roles: asStringArray(module.roles),
    }))
    .filter((module) => module.name !== '');

  return {
    projectName: requirements.projectName,
    summary: asString(source.summary, `A ${requirements.projectType} application.`),
    modules,
    journeys: asRecordArray(source.journeys)
      .map((journey) => ({
        name: asString(journey.name),
        actor: asString(journey.actor, requirements.roles[0] ?? 'User'),
        steps: asStringArray(journey.steps),
        modules: asStringArray(journey.modules),
      }))
      .filter((journey) => journey.name !== '' && journey.steps.length > 0),
    screens: asRecordArray(source.screens)
      .map((screen) => ({
        name: asString(screen.name),
        purpose: asString(screen.purpose, ''),
        module: asString(screen.module, ''),
        roles: asStringArray(screen.roles),
      }))
      .filter((screen) => screen.name !== ''),
    businessRules: asRecordArray(source.businessRules)
      .map((entry) => ({ rule: asString(entry.rule), module: asString(entry.module, '') }))
      .filter((entry) => entry.rule !== ''),
    roles: requirements.roles,
  };
}

/**
 * Merges the analyst's richer fields onto the legacy spec shape.
 *
 * The rule-based analyzer produces the legacy fields only; the AI analyst
 * produces both. This keeps the enrichment optional at the type level and
 * absent rather than empty when it was not produced — an empty array reads
 * as "none exist", which is a different claim from "not analyzed".
 */
export function mergeRequirementDetail(base: RequirementSpec, raw: unknown): RequirementSpec {
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;

  const detail = {
    goal: asString(source.goal),
    functionalRequirements: asStringArray(source.functionalRequirements),
    nonFunctionalRequirements: asStringArray(source.nonFunctionalRequirements),
    constraints: asStringArray(source.constraints),
    assumptions: asStringArray(source.assumptions),
    securityRequirements: asStringArray(source.securityRequirements),
    acceptanceCriteria: asStringArray(source.acceptanceCriteria),
  };

  return {
    ...base,
    ...(detail.goal ? { goal: detail.goal } : {}),
    ...(detail.functionalRequirements.length
      ? { functionalRequirements: detail.functionalRequirements }
      : {}),
    ...(detail.nonFunctionalRequirements.length
      ? { nonFunctionalRequirements: detail.nonFunctionalRequirements }
      : {}),
    ...(detail.constraints.length ? { constraints: detail.constraints } : {}),
    ...(detail.assumptions.length ? { assumptions: detail.assumptions } : {}),
    ...(detail.securityRequirements.length
      ? { securityRequirements: detail.securityRequirements }
      : {}),
    ...(detail.acceptanceCriteria.length ? { acceptanceCriteria: detail.acceptanceCriteria } : {}),
  };
}
