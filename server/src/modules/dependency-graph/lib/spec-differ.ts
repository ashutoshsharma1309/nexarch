/**
 * Prompt-level diffing for intelligent regeneration (Phase 13). The
 * existing analyze/regenerate flow answers "what does THIS change touch?"
 * for a hand-written change request; this differ derives those change
 * requests automatically by comparing the requirement spec the current
 * project was built from against the spec a new prompt analyzes into.
 * Diffing the structured specs (not the raw prompt strings) is what makes
 * the result reliable: rewording a sentence produces no diff, while a new
 * entity produces exactly one.
 */
import type { RequirementSpec } from '../../../shared/types/requirement.js';

export type SpecCategory =
  'roles' | 'modules' | 'frontend' | 'backend' | 'database' | 'authentication' | 'integrations';

export interface SpecCategoryDiff {
  category: SpecCategory;
  added: string[];
  removed: string[];
  unchanged: string[];
}

export interface SpecDiff {
  categories: SpecCategoryDiff[];
  addedCount: number;
  removedCount: number;
  unchangedCount: number;
  /** True when nothing observable changed — regeneration can be skipped entirely. */
  identical: boolean;
  /**
   * Natural-language change requests synthesized from the diff, in the same
   * vocabulary `change-detector.ts` seeds from — these feed the existing
   * impact analyzer unchanged.
   */
  changeRequests: string[];
  summary: string;
}

const CATEGORIES: readonly SpecCategory[] = [
  'roles',
  'modules',
  'frontend',
  'backend',
  'database',
  'authentication',
  'integrations',
];

/** Case-insensitive set difference that reports survivors in original casing. */
function diffLists(
  before: readonly string[],
  after: readonly string[],
): { added: string[]; removed: string[]; unchanged: string[] } {
  const beforeKeys = new Set(before.map((v) => v.toLowerCase()));
  const afterKeys = new Set(after.map((v) => v.toLowerCase()));
  return {
    added: after.filter((v) => !beforeKeys.has(v.toLowerCase())),
    removed: before.filter((v) => !afterKeys.has(v.toLowerCase())),
    unchanged: after.filter((v) => beforeKeys.has(v.toLowerCase())),
  };
}

const CATEGORY_VERBS: Record<SpecCategory, { add: string; remove: string }> = {
  roles: { add: 'Add the user role', remove: 'Remove the user role' },
  modules: { add: 'Add the module', remove: 'Remove the module' },
  frontend: { add: 'Add the frontend feature', remove: 'Remove the frontend feature' },
  backend: { add: 'Add the backend capability', remove: 'Remove the backend capability' },
  database: { add: 'Add the data requirement', remove: 'Remove the data requirement' },
  authentication: {
    add: 'Add the authentication feature',
    remove: 'Remove the authentication feature',
  },
  integrations: { add: 'Add the integration', remove: 'Remove the integration' },
};

export function diffSpecs(oldSpec: RequirementSpec, newSpec: RequirementSpec): SpecDiff {
  const categories: SpecCategoryDiff[] = [];
  const changeRequests: string[] = [];
  let addedCount = 0;
  let removedCount = 0;
  let unchangedCount = 0;

  for (const category of CATEGORIES) {
    const { added, removed, unchanged } = diffLists(oldSpec[category], newSpec[category]);
    categories.push({ category, added, removed, unchanged });
    addedCount += added.length;
    removedCount += removed.length;
    unchangedCount += unchanged.length;

    const verbs = CATEGORY_VERBS[category];
    for (const item of added) changeRequests.push(`${verbs.add} ${item}`);
    for (const item of removed) changeRequests.push(`${verbs.remove} ${item}`);
  }

  const identical = addedCount === 0 && removedCount === 0;
  const summary = identical
    ? 'The new prompt analyzes to the same requirement spec — nothing to regenerate.'
    : `${String(addedCount)} requirement(s) added, ${String(removedCount)} removed, ` +
      `${String(unchangedCount)} unchanged across ${String(
        categories.filter((c) => c.added.length > 0 || c.removed.length > 0).length,
      )} categories.`;

  return {
    categories,
    addedCount,
    removedCount,
    unchangedCount,
    identical,
    changeRequests,
    summary,
  };
}
