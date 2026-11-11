/**
 * Finding a node by what it *is* rather than by its database id.
 *
 * A node id is assigned on write, so the only callers that can hold one are
 * callers that have already read the graph. Everything else names a node the
 * way the rest of the system names things: a file path, a canonical name, an
 * endpoint, a review agent's `targetNodeId`. Without a lookup for that,
 * answering "what does changing this file affect" means fetching the whole
 * graph and matching client-side, which is what the project editor and the
 * UI's trace view both ended up doing.
 *
 * This resolution lived inside the builder, over draft nodes. It is here so
 * the draft and the persisted graph resolve an identity the same way — two
 * implementations of "which node did you mean" would drift, and the one that
 * drifted would link findings to the wrong thing.
 */
import { canonicalize, canonicalizePath, nodeKey } from './canonical.js';
import { GRAPH_NODE_TYPES } from '../../../shared/contracts/engineering-graph.js';
import type { GraphNode, GraphNodeType } from '../../../shared/contracts/engineering-graph.js';

/**
 * A store of nodes that can be asked for one by type and name.
 *
 * `exact` matches the canonical name verbatim, for the types whose key keeps
 * structure — FILE, TEST, DEPENDENCY, API. `folded` runs the name through
 * `canonicalize` first, for the types whose key is a folded name.
 */
export interface IdentityLookup<T> {
  exact: (type: GraphNodeType, canonicalName: string) => T | undefined;
  folded: (type: GraphNodeType, name: string) => T | undefined;
}

/**
 * The node named by a node identity: either the `TYPE::canonical-name` key
 * nodes are deduplicated by, or a bare name tried against every type.
 *
 * Forms are tried before types so a weak match on an early type cannot
 * beat an exact one on a later type, and the identity is tried verbatim
 * first because several types keep structure in their key — an API node is
 * `GET /api/orders`, with the method upper-cased, and path folding would
 * destroy it. `GRAPH_NODE_TYPES` fixes the order, so a name that two types
 * both carry always resolves to the same node rather than to whichever was
 * built first.
 */
export function nodeByIdentity<T>(lookup: IdentityLookup<T>, identity: string): T | undefined {
  const separator = identity.indexOf('::');
  if (separator > 0) {
    const type = identity.slice(0, separator);
    const name = identity.slice(separator + 2);
    if (!isNodeType(type)) return undefined;
    return lookup.exact(type, name) ?? lookup.folded(type, name);
  }

  for (const key of [identity, canonicalizePath(identity)]) {
    for (const type of GRAPH_NODE_TYPES) {
      const node = lookup.exact(type, key);
      if (node) return node;
    }
  }
  for (const type of GRAPH_NODE_TYPES) {
    const node = lookup.folded(type, identity);
    if (node) return node;
  }
  return undefined;
}

/** The identity string a `type` plus a path or name make, for the form above. */
export function identityOf(type: GraphNodeType, name: string): string {
  return `${type}::${name}`;
}

export function isNodeType(value: string): value is GraphNodeType {
  return GRAPH_NODE_TYPES.some((type) => type === value);
}

/**
 * A lookup over nodes already loaded from the database.
 *
 * One map, keyed exactly as the stored `canonicalName` — the difference
 * between the two accessors is whether the *query* gets folded, which is
 * how the builder's collector has always worked. Keying a second map on
 * folded stored names would be wrong: a FILE's canonical name is a path,
 * and folding it produces a key nothing would ever ask for.
 */
export function lookupOverNodes(nodes: readonly GraphNode[]): IdentityLookup<GraphNode> {
  const byKey = new Map<string, GraphNode>();
  for (const node of nodes) {
    const key = nodeKey(node.type, node.canonicalName);
    // The unique index guarantees one node per (type, canonicalName), so a
    // collision here means a caller passed two projects' nodes at once.
    if (!byKey.has(key)) byKey.set(key, node);
  }

  return {
    exact: (type, canonicalName) => byKey.get(nodeKey(type, canonicalName)),
    folded: (type, name) => byKey.get(nodeKey(type, canonicalize(name))),
  };
}
