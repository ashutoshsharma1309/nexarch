/**
 * Requirement tracing, in one place.
 *
 * "Which code implements this requirement?" and "which requirements does
 * this file serve?" are the same question read from either end, and they
 * were answered twice in two shapes: this module offered a generic
 * `findPath` with `direction: 'any'`, while the context engine hand-rolled a
 * one- and two-hop IMPLEMENTS walk straight over the edge array. Two
 * implementations of one question drift, and the one that drifts is the one
 * a user is reading when they decide a requirement is covered.
 *
 * So this is the named function, built on the traversal this module already
 * has. It walks the chain the builder actually lays down —
 *
 *   REQUIREMENT ← FEATURE/MODULE → SERVICE/API/COMPONENT → FILE/TEST
 *
 * — in either direction, and returns the real path to each endpoint so the
 * answer carries its own evidence rather than asking to be trusted.
 *
 * Two types are never walked *through*. PROJECT contains everything, so a
 * trace allowed through the root reaches every file in the project and
 * "proves" that every requirement is implemented by all of them. FOLDER is
 * the same mistake one level down: two files sharing a directory is not
 * evidence that one serves the other's requirement. Both are still perfectly
 * good nodes; they are just not evidence of implementation.
 */
import type {
  GraphNode,
  GraphNodeType,
  RequirementTrace,
  RequirementTraceLink,
  TraceDirection,
} from '../../../shared/contracts/engineering-graph.js';
import { findPath, traverseBounded } from './graph-queries.js';
import type { GraphIndex } from './graph-queries.js';

/** What a requirement ends up as, and what a trace back up starts from. */
const IMPLEMENTATION_TYPES: GraphNodeType[] = [
  'FEATURE',
  'MODULE',
  'SERVICE',
  'API',
  'COMPONENT',
  'FILE',
  'TEST',
];

const REQUIREMENT_TYPES: GraphNodeType[] = ['REQUIREMENT'];

/** Containment-only hubs: real nodes, but not evidence of implementation. */
const NOT_EVIDENCE: GraphNodeType[] = ['PROJECT', 'FOLDER'];

/**
 * Four hops, which is the chain's own length: requirement → feature →
 * module → file is three, and requirement → feature → api → service →
 * entity is four.
 *
 * Not five. At five, the service-to-service USES edges the architecture
 * states join one module's file to another module's requirements, so an
 * authentication service traced back up reported seven requirements instead
 * of the one it implements. Each of those was a real chain of real edges,
 * which is exactly why the bound has to be the length of the relationship
 * being traced rather than as far as the graph happens to reach.
 */
const DEFAULT_TRACE_DEPTH = 4;
const DEFAULT_TRACE_LIMIT = 200;

export interface TraceOptions {
  maxDepth?: number;
  limit?: number;
}

/**
 * Which way to trace from a node, when the caller did not say.
 *
 * A requirement can only be traced downward and anything else is being
 * traced back up, so the origin's own type answers it.
 */
export function traceDirectionFor(node: GraphNode): TraceDirection {
  return node.type === 'REQUIREMENT' ? 'to-implementation' : 'to-requirements';
}

export function traceRequirements(
  index: GraphIndex,
  origin: GraphNode,
  direction: TraceDirection,
  options: TraceOptions = {},
): RequirementTrace {
  const maxDepth = options.maxDepth ?? DEFAULT_TRACE_DEPTH;
  const limit = options.limit ?? DEFAULT_TRACE_LIMIT;
  const wanted = direction === 'to-implementation' ? IMPLEMENTATION_TYPES : REQUIREMENT_TYPES;

  /*
   * `both`, not `outgoing`. The graph's edges point *toward* requirements —
   * a feature IMPLEMENTS a requirement, a module IMPLEMENTS a feature —
   * while the code below a module hangs off it the other way, so either
   * direction alone stops at the first turn in the chain.
   */
  const reached = traverseBounded(index, origin.id, 'both', {
    maxDepth,
    limit,
    nodeTypes: wanted,
    excludeNodeTypes: NOT_EVIDENCE,
  });

  const links: RequirementTraceLink[] = [];
  for (const related of reached.related) {
    const path = findPath(index, origin.id, related.node.id, maxDepth, 'any', {
      excludeNodeTypes: NOT_EVIDENCE,
    });
    // No path means no evidence to show, and a trace entry with nothing
    // behind it is exactly the claim this module must not make.
    if (!path) continue;
    links.push({
      node: related.node,
      depth: related.depth,
      direct: related.depth === 1,
      path,
    });
  }

  links.sort((a, b) => a.depth - b.depth || a.node.name.localeCompare(b.node.name));

  return { origin, direction, links, maxDepth, truncated: reached.truncated };
}
