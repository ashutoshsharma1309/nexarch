/**
 * Stable node identity.
 *
 * The same thing gets spelled differently by different artifacts: the
 * requirement says "Order Management", the plan says "orders", the
 * generated code says "OrderService". A graph that treated those as three
 * unrelated nodes would be worse than no graph — every traversal would
 * dead-end at a spelling difference.
 *
 * So identity is `(projectId, type, canonicalName)`, and canonicalization
 * is deliberately *conservative*: it folds case, separators and a small
 * set of structural suffixes, and stops there. It does not stem, it does
 * not singularize arbitrary words, and it does not fuzzy-match. Merging
 * two genuinely different entities is unrecoverable damage; leaving two
 * spellings unmerged is a visible, fixable gap. Given that asymmetry, this
 * errs toward not merging.
 *
 * Type is part of the key, which is what makes the aggressive-looking
 * suffix stripping safe: an `ENTITY` called "Order" and a `SERVICE` called
 * "OrderService" both canonicalize to `order`, and stay separate nodes
 * because their types differ.
 */
import type { GraphNodeType } from '../../../shared/contracts/engineering-graph.js';

/**
 * Role suffixes the generators append mechanically. Stripping them is what
 * lets `OrderService` (plan) and `orders` (module) resolve to one service.
 * Only ever stripped when something remains — `Service` on its own stays
 * `service`.
 */
const ROLE_SUFFIXES = [
  'controller',
  'service',
  'repository',
  'module',
  'component',
  'page',
  'entity',
  'model',
  'table',
  'manager',
  'handler',
];

/** Irregular plurals worth knowing; anything else uses the `-s`/`-es` rules. */
const IRREGULAR_PLURALS: Record<string, string> = {
  people: 'person',
  children: 'child',
  men: 'man',
  women: 'woman',
  data: 'datum',
  indices: 'index',
  matrices: 'matrix',
};

/** Words that end in `s` but are not plural — singularizing them corrupts the name. */
const NOT_PLURAL = new Set([
  'status',
  'statuses',
  'address',
  'access',
  'analysis',
  'business',
  'class',
  'process',
  'progress',
  'settings',
  'credentials',
  'preferences',
  'metrics',
  'analytics',
  'cors',
  'https',
  'news',
  'series',
  'species',
]);

/**
 * Activity words the product layer appends to a noun that the architecture
 * layer states bare: the product spec says "Payment Processing" where the
 * plan says "Payments", "Product Catalog" where the plan says "Products".
 * They name what is done with the thing, not a different thing, so they
 * fold away — the same reasoning that has always stripped "Management".
 *
 * This list stays short and literal on purpose. Every entry is a word that
 * cannot, on its own, distinguish two features of one product; anything
 * that could is left alone, because a wrong merge is unrecoverable and an
 * unmerged pair is merely visible.
 */
const QUALIFIER_SUFFIXES = new Set([
  'management',
  'managements',
  'processing',
  'administration',
  'catalog',
  'catalogue',
  'dashboard',
  'tracking',
]);

/** Split into lowercase words across camelCase, snake_case, kebab-case and spaces. */
function words(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .map((word) => word.trim().toLowerCase())
    .filter(Boolean);
}

/** Conservative singularization — returns the input unchanged when unsure. */
export function singularize(word: string): string {
  if (IRREGULAR_PLURALS[word]) return IRREGULAR_PLURALS[word];
  if (NOT_PLURAL.has(word) || word.length <= 3) return word;
  if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`;

  /**
   * `-es` is dropped only after a genuine sibilant cluster: `classes` →
   * `class`, `boxes` → `box`, `dishes` → `dish`.
   *
   * A bare `-ses` is not one of those. An earlier version treated it as
   * such and turned `courses` into `cours`, which meant the requirement's
   * "Courses" and the product's "Course Management" canonicalized
   * differently and the consistency checker reported a mismatch between
   * two names for the same thing. It also gave the Engineering Graph two
   * nodes where there should have been one.
   */
  if (/(?:sses|shes|ches|xes|zes)$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('us')) {
    return word.slice(0, -1);
  }
  return word;
}

/**
 * The canonical form of a name within a node type.
 *
 * `Order Management` → `order` · `OrderService` → `order` ·
 * `orders` → `order` · `order_items` → `order-item`
 */
export function canonicalize(name: string): string {
  let parts = words(name);
  if (parts.length === 0) return 'unnamed';

  // Strip a trailing role word, but never the only word.
  const last = parts[parts.length - 1];
  if (parts.length > 1 && last && ROLE_SUFFIXES.includes(last)) {
    parts = parts.slice(0, -1);
  }
  // "Order Management" and "Order" are the same feature.
  const tail = parts[parts.length - 1];
  if (parts.length > 1 && tail && QUALIFIER_SUFFIXES.has(tail)) {
    parts = parts.slice(0, -1);
  }

  return parts.map(singularize).join('-');
}

/**
 * Canonical form for names where structure carries meaning and must not be
 * folded away: file paths, endpoint paths, package names. Case and
 * separators are normalized, nothing is stripped or singularized —
 * `src/orders.ts` and `src/order.ts` are different files.
 */
export function canonicalizePath(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Canonical form for an endpoint: method plus path, both structural. */
export function canonicalizeEndpoint(method: string, path: string): string {
  return `${method.trim().toUpperCase()} ${canonicalizePath(path)}`;
}

/** The key a draft node is deduplicated by. */
export function nodeKey(type: GraphNodeType, canonicalName: string): string {
  return `${type}::${canonicalName}`;
}
