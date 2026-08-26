/**
 * Repairs a model-produced `RequirementSpec` into one the deterministic
 * stages can actually consume.
 *
 * The downstream planners are strict about shape in ways a language model
 * is not reliably strict about: entity names must be PascalCase plural with
 * no spaces (they become table names and Prisma models), lists must be
 * strings, and `Users` must exist because authentication is generated
 * against it. Rather than fail the run on a near-miss — or retry the model
 * until it happens to comply — the fixes that are mechanical get made
 * mechanically here. That is also why this is code and not a second prompt.
 */
import type { RequirementSpec } from '../../../shared/types/requirement.js';

const MAX_ENTITIES = 14;
const MAX_LIST = 20;

/**
 * Filler words a model attaches to a module name that an entity name never
 * carries: "Patient Management" and "Patients" are the same module.
 */
const MODULE_SUFFIX_NOISE =
  /\b(management|managing|tracking|scheduling|schedule|catalog|catalogue|module|system|engine|handling|processing|administration|admin|records?|master)\b/g;

function asStringList(value: unknown, limit = MAX_LIST): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    const text = typeof item === 'string' ? item.trim() : '';
    if (!text || text.length > 80) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

const IRREGULAR_PLURALS: Record<string, string> = {
  Person: 'People',
  Child: 'Children',
  Man: 'Men',
  Woman: 'Women',
  Datum: 'Data',
};

/** `order items` / `order_item` / `OrderItem` → `OrderItems`. */
export function toEntityName(raw: string): string | null {
  const words = raw
    .replace(/[^A-Za-z0-9]+/g, ' ')
    // Split camelCase/PascalCase runs so "orderItem" becomes two words.
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return null;

  const pascal = words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('');
  if (pascal.length < 3 || pascal.length > 40) return null;

  return pluralize(pascal);
}

/**
 * Nouns ending in `s` are usually already plural (`Users`, `Orders`), but
 * some are singular words that merely end that way (`Address`, `Class`,
 * `Status`). Getting this wrong is not cosmetic: entity names are the join
 * key for the planner's relationship table, so a stray `Userses` silently
 * costs the schema every foreign key it should have had.
 */
function isAlreadyPlural(name: string): boolean {
  if (/(?:ss|us|is)$/i.test(name)) return false;
  return /(?:s|ies)$/i.test(name);
}

function pluralize(name: string): string {
  const irregular = Object.entries(IRREGULAR_PLURALS).find(([singular]) => name.endsWith(singular));
  if (irregular) return name.slice(0, -irregular[0].length) + irregular[1];

  if (isAlreadyPlural(name)) return name;
  if (/(?:s|x|z|ch|sh)$/i.test(name)) return `${name}es`;
  if (/[^aeiou]y$/i.test(name)) return `${name.slice(0, -1)}ies`;
  return `${name}s`;
}

function slugType(value: unknown, fallback: string): string {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!text) return fallback;
  const slug = text.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slug.length >= 3 && slug.length <= 40 ? slug : fallback;
}

export interface NormalizeOptions {
  /** Falls back to this when the model omitted or mangled the name. */
  projectName: string;
}

/** Collapse a name to a comparison key: letters and digits only, singularized. */
function moduleKey(raw: string): string {
  const bare = raw.toLowerCase().replace(MODULE_SUFFIX_NOISE, ' ');
  const compact = bare.replace(/[^a-z0-9]+/g, '');
  return compact.replace(/(?:ies|es|s)$/, '');
}

/**
 * Reconcile module names against the entity list.
 *
 * The generators treat a module whose name *is* an entity name as
 * entity-backed and emit real CRUD for it; anything else becomes a
 * placeholder page. That contract is why the built-in knowledge base names
 * modules `Products` and `Appointments` rather than "Product Catalog" and
 * "Appointment Scheduling" — and why a model that answers in the prose
 * spelling would otherwise produce an application of "not implemented yet"
 * screens. Rewriting the prose spelling back to the entity name here keeps
 * the contract intact without constraining what the model is allowed to say.
 */
function reconcileModules(modules: string[], entities: string[]): string[] {
  const entityByKey = new Map(entities.map((entity) => [moduleKey(entity), entity]));

  const out: string[] = [];
  for (const module of modules) {
    const match = entityByKey.get(moduleKey(module));
    const resolved = match ?? module;
    if (!out.includes(resolved)) out.push(resolved);
  }
  return out;
}

export function normalizeSpec(value: unknown, options: NormalizeOptions): RequirementSpec {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;

  const projectName =
    typeof raw.projectName === 'string' && raw.projectName.trim().length >= 2
      ? raw.projectName.trim().slice(0, 120)
      : options.projectName;

  const entities: string[] = [];
  for (const candidate of asStringList(raw.database, MAX_ENTITIES * 2)) {
    const name = toEntityName(candidate);
    if (name && !entities.includes(name)) entities.push(name);
    if (entities.length >= MAX_ENTITIES) break;
  }
  // Authentication, RBAC and the generated login screens are all built
  // against a Users table; a spec without one produces an app nobody can
  // sign in to.
  if (!entities.includes('Users')) entities.unshift('Users');

  const roles = asStringList(raw.roles, 8).map((role) =>
    role
      .replace(/[^A-Za-z0-9 ]+/g, ' ')
      .trim()
      .split(/\s+/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(''),
  );
  if (roles.length === 0) roles.push('Admin', 'User');
  if (!roles.some((role) => /admin/i.test(role))) roles.unshift('Admin');

  const entityList = entities.slice(0, MAX_ENTITIES);
  const modules = reconcileModules(asStringList(raw.modules, 14), entityList);

  return {
    projectName,
    projectType: slugType(raw.projectType, 'custom'),
    roles,
    modules: modules.length > 0 ? modules : ['Authentication', ...entityList.slice(1, 4)],
    frontend: asStringList(raw.frontend, 14),
    backend: asStringList(raw.backend, 14),
    database: entityList,
    authentication:
      asStringList(raw.authentication, 8).length > 0
        ? asStringList(raw.authentication, 8)
        : ['Email and password', 'JWT sessions'],
    integrations: asStringList(raw.integrations, 8),
    missingRequirements: asStringList(raw.missingRequirements, 10),
  };
}
