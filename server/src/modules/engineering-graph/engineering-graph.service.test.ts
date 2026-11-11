/**
 * Engineering Graph unit tests (`npm test`).
 *
 * Two halves. The first pins canonicalization, because it is the one piece
 * whose failure mode is silent: over-merge and two real entities become
 * one node, under-merge and every traversal dead-ends at a spelling
 * difference. Neither shows up as an error.
 *
 * The second builds a graph from a *real* pipeline run — the deterministic
 * generators, no model calls — and asserts the relationships the artifacts
 * actually imply. Asserting against a hand-written fixture would only
 * prove the fixture matches itself.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deriveSiteDesign } from '../frontend-generator/frontend-generator.service.js';

import { analyzeRequirements } from '../analysis/analysis.service.js';
import { planArchitecture } from '../architecture/architecture.service.js';
import { generateBackend } from '../backend-generator/backend-generator.service.js';
import { designDatabase } from '../database-designer/database-designer.service.js';
import { buildDependencyGraphBundle } from '../dependency-graph/dependency-graph.service.js';
import { generateFrontend } from '../frontend-generator/frontend-generator.service.js';
import { applySecurity } from '../security-engine/security-engine.service.js';
import { canonicalize, canonicalizeEndpoint, singularize } from './lib/canonical.js';
import { buildGraph } from './lib/graph-builder.js';
import {
  childrenOf,
  dependenciesOf,
  dependentsOf,
  findPath,
  indexGraph,
  neighbourhoodOf,
  nodesByType,
  traverseBounded,
} from './lib/graph-queries.js';
import { analyzeImpact } from './lib/impact-analysis.js';
import { validateGraph } from './lib/graph-validator.js';
import { identityOf, lookupOverNodes, nodeByIdentity } from './lib/node-identity.js';
import { traceDirectionFor, traceRequirements } from './lib/requirement-trace.js';
import type { ReviewFindingDraft } from './lib/graph-builder.js';
import type { PipelineArtifacts } from '../pipeline/pipeline.types.js';
import type {
  DraftNode,
  GraphEdge,
  GraphNode,
  GraphNodeType,
  GraphRelationship,
} from '../../shared/contracts/index.js';

/* ── Canonicalization ─────────────────────────────────────────────────── */

describe('canonicalization', () => {
  it('folds case, separators and role suffixes to one identity', () => {
    // The three spellings the same service gets across three artifacts.
    assert.equal(canonicalize('User Service'), 'user');
    assert.equal(canonicalize('user service'), 'user');
    assert.equal(canonicalize('user-service'), 'user');
    assert.equal(canonicalize('UserService'), 'user');
    assert.equal(canonicalize('users'), 'user');
  });

  it('folds the planner’s vocabulary onto the requirement’s', () => {
    assert.equal(canonicalize('Order Management'), 'order');
    assert.equal(canonicalize('orders'), 'order');
  });

  /**
   * The product layer names a feature by the activity ("Payment
   * Processing") where the deterministic planner names it by the noun
   * ("Payments"). Before these folded together, an e-commerce run produced
   * ten FEATURE nodes for seven features — Products/Product Catalog,
   * Payments/Payment Processing and Admin/Admin Dashboard each appeared
   * twice, unconnected, so impact analysis dead-ended between the product
   * layer and the architecture that implements it.
   */
  it('folds the product layer’s activity words onto the planner’s nouns', () => {
    assert.equal(canonicalize('Payment Processing'), canonicalize('Payments'));
    assert.equal(canonicalize('Product Catalog'), canonicalize('Products'));
    assert.equal(canonicalize('Admin Dashboard'), canonicalize('Admin'));
    assert.equal(canonicalize('Inventory Tracking'), canonicalize('Inventory'));
  });

  it('strips a qualifier only when a name remains', () => {
    assert.equal(canonicalize('Dashboard'), 'dashboard');
    assert.equal(canonicalize('Catalog'), 'catalog');
    assert.equal(canonicalize('Management'), 'management');
  });

  it('keeps genuinely different names apart', () => {
    assert.notEqual(canonicalize('Order'), canonicalize('OrderItem'));
    assert.notEqual(canonicalize('Payment'), canonicalize('Product'));
    assert.notEqual(canonicalize('User'), canonicalize('UserGroup'));
  });

  it('never strips a role word that is the whole name', () => {
    assert.equal(canonicalize('Service'), 'service');
    assert.equal(canonicalize('Component'), 'component');
  });

  it('singularizes conservatively, leaving non-plurals alone', () => {
    assert.equal(singularize('categories'), 'category');
    assert.equal(singularize('boxes'), 'box');
    // Words that merely end in `s` must survive intact.
    assert.equal(singularize('status'), 'status');
    assert.equal(singularize('address'), 'address');
    assert.equal(singularize('analysis'), 'analysis');
  });

  it('preserves structure in paths and endpoints', () => {
    // Folding these would merge genuinely different routes and files.
    assert.notEqual(
      canonicalizeEndpoint('GET', '/api/v1/orders'),
      canonicalizeEndpoint('POST', '/api/v1/orders'),
    );
    assert.equal(canonicalizeEndpoint('get', '/API/v1/Orders'), 'GET /api/v1/orders');
  });
});

/* ── A real project ───────────────────────────────────────────────────── */

function buildArtifacts(prompt: string): PipelineArtifacts {
  const analysis = analyzeRequirements(prompt);
  assert.equal(analysis.status, 'COMPLETE');
  const requirements = analysis.spec;
  const { plan, markdown } = planArchitecture(requirements);
  const design = designDatabase(plan, requirements);
  const backend = generateBackend(
    plan,
    requirements,
    design.databaseDesign,
    design.prismaSchema,
    design.openapi,
    design.validationRules.entities,
    design.entityMetadata,
  );
  const backendManifest = { modules: backend.modules, routes: backend.routes };
  const frontend = generateFrontend(
    plan,
    requirements,
    design.databaseDesign,
    design.openapi,
    backendManifest,
    design.entityMetadata,
  );
  const security = applySecurity({
    requirements,
    architecture: plan,
    database: design.databaseDesign,
    openapi: design.openapi,
    entityMetadata: design.entityMetadata,
    backendManifest,
    frontendManifest: {
      pages: frontend.pages.map((p) => ({
        name: p.name,
        route: p.route,
        kind: p.kind,
        entity: p.entity,
        implemented: p.implemented,
      })),
    },
  });
  const { bundle: dependencies } = buildDependencyGraphBundle({
    requirements,
    architecture: plan,
    database: design.databaseDesign,
    backend: { files: backend.files, modules: backend.modules, routes: backend.routes },
    frontend: {
      files: frontend.files,
      pages: frontend.pages,
      components: frontend.components,
      routes: frontend.routes,
      stores: frontend.stores,
    },
    security: {
      backendFiles: security.backendFiles,
      frontendFiles: security.frontendFiles,
      rbac: { roles: security.rbac.roles, permissions: security.permissions },
    },
  });

  const overlay = (
    base: { path: string; content: string }[],
    hardened: { path: string; content: string }[],
    prefix: string,
  ) => {
    const byPath = new Map(base.map((f) => [f.path, f.content]));
    for (const f of hardened) byPath.set(f.path, f.content);
    return [...byPath.entries()].map(([path, content]) => ({ path: `${prefix}/${path}`, content }));
  };

  return {
    runId: 'test-run',
    requirements,
    architecture: plan,
    architectureMarkdown: markdown,
    design,
    backend,
    frontend,
    security,
    dependencies,
    siteDesign: deriveSiteDesign(requirements),
    files: [
      ...overlay(backend.files, security.backendFiles, 'backend'),
      ...overlay(frontend.files, security.frontendFiles, 'frontend'),
    ],
  };
}

/** Turns a draft into stored-shape nodes/edges so the query layer can be exercised. */
function materialize(draft: ReturnType<typeof buildGraph>): {
  nodes: GraphNode[];
  edges: GraphEdge[];
} {
  const now = new Date().toISOString();
  const idFor = (type: GraphNodeType, canonicalName: string): string => `${type}::${canonicalName}`;

  const nodes: GraphNode[] = draft.nodes.map((node: DraftNode) => ({
    id: idFor(node.type, node.canonicalName),
    projectId: 'p1',
    runId: 'r1',
    type: node.type,
    canonicalName: node.canonicalName,
    name: node.name,
    description: node.description ?? null,
    metadata: node.metadata ?? {},
    sourceArtifactId: node.sourceArtifactId,
    createdAt: now,
    updatedAt: now,
  }));

  const edges: GraphEdge[] = draft.edges.map((edge, index) => ({
    id: `e${String(index)}`,
    projectId: 'p1',
    runId: 'r1',
    sourceNodeId: idFor(edge.from.type, edge.from.canonicalName),
    targetNodeId: idFor(edge.to.type, edge.to.canonicalName),
    relationship: edge.relationship,
    metadata: edge.metadata ?? {},
    createdAt: now,
  }));

  return { nodes, edges };
}

describe('graph builder (e-commerce project)', () => {
  const artifacts = buildArtifacts(
    'Build an e-commerce platform with authentication, products, cart, orders and payments.',
  );
  const draft = buildGraph(artifacts);
  const { nodes, edges } = materialize(draft);
  const index = indexGraph(nodes, edges);

  const find = (type: GraphNodeType, canonicalName: string): GraphNode | undefined =>
    nodes.find((node) => node.type === type && node.canonicalName === canonicalName);

  it('produces every node type the project actually contains', () => {
    const present = new Set(nodes.map((node) => node.type));
    for (const type of [
      'PROJECT',
      'REQUIREMENT',
      'FEATURE',
      'COMPONENT',
      'SERVICE',
      'API',
      'ENTITY',
      'FIELD',
      'FILE',
      'FOLDER',
      'MODULE',
      'SECURITY_RULE',
      'DEPENDENCY',
      'TEST',
    ] as GraphNodeType[]) {
      assert.ok(present.has(type), `expected at least one ${type} node`);
    }
  });

  it('emits no duplicate nodes and no duplicate edges', () => {
    const nodeKeys = nodes.map((node) => `${node.type}::${node.canonicalName}`);
    assert.equal(new Set(nodeKeys).size, nodeKeys.length, 'nodes must be unique by identity');

    const edgeKeys = edges.map((e) => `${e.sourceNodeId}|${e.relationship}|${e.targetNodeId}`);
    assert.equal(new Set(edgeKeys).size, edgeKeys.length, 'edges must be unique');
  });

  it('never emits a self-loop or an edge to a node it did not create', () => {
    const ids = new Set(nodes.map((node) => node.id));
    for (const edge of edges) {
      assert.notEqual(edge.sourceNodeId, edge.targetNodeId);
      assert.ok(ids.has(edge.sourceNodeId), `dangling source ${edge.sourceNodeId}`);
      assert.ok(ids.has(edge.targetNodeId), `dangling target ${edge.targetNodeId}`);
    }
  });

  it('derives entity relationships from real foreign keys', () => {
    // The database design says orders.user_id references users. The graph
    // must say the same thing, without anyone hard-coding it here.
    const orders = find('ENTITY', 'order');
    const users = find('ENTITY', 'user');
    assert.ok(orders && users, 'e-commerce spec should produce Orders and Users');

    const belongsTo = edges.filter(
      (edge) => edge.relationship === 'BELONGS_TO' && edge.sourceNodeId === orders.id,
    );
    assert.ok(
      belongsTo.some((edge) => edge.targetNodeId === users.id),
      'Order should BELONG_TO User',
    );
  });

  it('links a feature to the requirement it implements', () => {
    const implementsEdges = edges.filter((edge) => edge.relationship === 'IMPLEMENTS');
    assert.ok(implementsEdges.length > 0, 'features should implement requirements');

    const featureIds = new Set(nodesByType(index, 'FEATURE').map((n) => n.id));
    const requirementIds = new Set(nodesByType(index, 'REQUIREMENT').map((n) => n.id));
    assert.ok(
      implementsEdges.some(
        (edge) => featureIds.has(edge.sourceNodeId) && requirementIds.has(edge.targetNodeId),
      ),
      'at least one FEATURE → REQUIREMENT link',
    );
  });

  it('links a service to the entity it persists', () => {
    const persists = edges.filter((edge) => edge.relationship === 'PERSISTS');
    assert.ok(persists.length > 0);
    const entityIds = new Set(nodesByType(index, 'ENTITY').map((n) => n.id));
    assert.ok(persists.every((edge) => entityIds.has(edge.targetNodeId)));
  });

  it('gives every entity its fields', () => {
    const users = find('ENTITY', 'user');
    assert.ok(users);
    const fields = childrenOf(index, users.id).related.filter((r) => r.node.type === 'FIELD');
    assert.ok(fields.length >= 3, 'Users should have several columns');
    assert.ok(fields.every((f) => f.node.name.startsWith('Users.')));
  });

  it('traces every node back to the artifact it came from', () => {
    for (const node of nodes) {
      if (node.type === 'PROJECT') continue;
      assert.ok(node.sourceArtifactId, `${node.type} "${node.name}" has no source artifact`);
    }
  });

  it('answers dependencies and dependents in opposite directions', () => {
    const orders = find('ENTITY', 'order');
    assert.ok(orders);

    // Dependencies: what Orders points at (its parent entities).
    const deps = dependenciesOf(index, orders.id, { relationships: ['BELONGS_TO'] });
    assert.ok(deps.related.length > 0, 'Orders should depend on the entities it references');
    assert.equal(deps.truncated, false, 'a complete answer must not claim to be capped');

    // Dependents: what points at Orders (its service, its fields' owner).
    const dependents = dependentsOf(index, orders.id);
    assert.ok(dependents.related.length > 0, 'something should depend on Orders');
    const dependentIds = new Set(dependents.related.map((d) => d.node.id));
    assert.ok(!dependentIds.has(orders.id), 'a node is never its own dependent');
  });

  it('returns a neighbourhood with both directions resolved', () => {
    const orders = find('ENTITY', 'order');
    assert.ok(orders);
    const hood = neighbourhoodOf(index, orders.id);
    assert.ok(hood);
    assert.equal(hood.node.id, orders.id);
    assert.ok(hood.outgoing.length + hood.incoming.length > 0);
    assert.ok(hood.outgoing.every((entry) => entry.node.id !== orders.id));
  });

  it('finds a dependency path from a page down to an entity', () => {
    const page = nodesByType(index, 'COMPONENT').find((node) =>
      Boolean((node.metadata as { entity?: string | null }).entity),
    );
    assert.ok(page, 'the frontend should have at least one entity page');
    const entityName = (page.metadata as { entity?: string | null }).entity;
    const entity = nodes.find(
      (node) => node.type === 'ENTITY' && node.canonicalName === canonicalize(entityName ?? ''),
    );
    assert.ok(entity);

    const path = findPath(index, page.id, entity.id);
    assert.ok(path, 'a page should reach the entity it edits');
    assert.equal(path.nodes[0]?.id, page.id);
    assert.equal(path.nodes[path.nodes.length - 1]?.id, entity.id);
    assert.equal(path.relationships.length, path.nodes.length - 1);
  });

  it('cannot reach a requirement from its code by following edges forwards', () => {
    // The graph's edges point *at* a requirement: a feature IMPLEMENTS one,
    // the project CONTAINS one. So a requirement has no outgoing edges, and
    // the traversal a reader most wants — "this requirement, where does it
    // end up?" — is impossible in the forward direction. This test pins the
    // reason the `any` direction exists.
    const requirement = nodes.find((node) => node.type === 'REQUIREMENT');
    assert.ok(requirement, 'the fixture has requirements');
    const file = nodes.find((node) => node.type === 'FILE');
    assert.ok(file, 'the fixture has files');

    assert.equal(
      findPath(index, requirement.id, file.id),
      null,
      'forwards-only traversal finds nothing, which is why it is not the default for a trace',
    );
  });

  it('traces a requirement to code when edges may be walked either way', () => {
    const requirement = nodes.find((node) => node.type === 'REQUIREMENT');
    assert.ok(requirement);
    const file = nodes.find((node) => node.type === 'FILE');
    assert.ok(file);

    const path = findPath(index, requirement.id, file.id, 6, 'any');
    assert.ok(path, 'a requirement is connected to the code built from it');
    assert.equal(path.nodes[0]?.id, requirement.id);
    assert.equal(path.nodes[path.nodes.length - 1]?.id, file.id);

    // Every hop is accounted for, and each one says which way its edge runs.
    assert.equal(path.hops.length, path.nodes.length - 1);
    assert.equal(path.relationships.length, path.hops.length);
    assert.deepEqual(
      path.hops.map((hop) => hop.relationship),
      path.relationships,
    );
    assert.ok(
      path.hops.some((hop) => hop.direction === 'backward'),
      'reaching a requirement means walking at least one edge against its direction',
    );

    // Every node on the path is a node this project actually holds.
    for (const node of path.nodes) {
      assert.ok(index.nodesById.has(node.id), `${node.name} is a real node`);
    }
  });

  it('a node traces to itself without inventing a hop', () => {
    const file = nodes.find((node) => node.type === 'FILE');
    assert.ok(file);
    const path = findPath(index, file.id, file.id, 6, 'any');
    assert.deepEqual(path, { nodes: [file], relationships: [], hops: [] });
  });

  it('impact analysis reports what a change reaches, never the origin', () => {
    const users = find('ENTITY', 'user');
    assert.ok(users);

    const impact = analyzeImpact(index, users, 3);
    assert.ok(impact.impacted.length > 0, 'changing Users must affect something');
    assert.ok(
      impact.impacted.every((entry) => entry.node.id !== users.id),
      'the origin is not its own impact',
    );
    // Fields are contained by the entity; a column change follows from it.
    assert.ok(
      impact.impacted.some((entry) => entry.node.type === 'FIELD'),
      'Users’ own columns are affected',
    );
    assert.ok(impact.impacted.every((entry) => entry.reason.length > 0));
    assert.ok(Object.keys(impact.summary).length > 0);
  });

  it('validates clean, with no dangling or duplicate edges', () => {
    const report = validateGraph(nodes, edges);
    const errors = report.issues.filter((issue) => issue.severity === 'error');
    assert.deepEqual(errors, [], 'a freshly built graph must have no structural errors');
    assert.ok(report.valid);
    assert.equal(report.checkedNodes, nodes.length);
    assert.equal(report.checkedEdges, edges.length);
  });

  /**
   * The regression this pins: impact analysis walks *incoming* edges, so the
   * node it reports is the edge's source and the changed node its target.
   * The reason table was phrased the other way round, so an incoming
   * CONTAINS — the changed node's parent — read "<parent> is contained by the
   * changed node", stating the opposite of the real dependency direction on
   * the one screen someone consults before touching something.
   */
  it('states the direction of the edge it walked, not its mirror image', () => {
    const field = nodes.find((node) => node.type === 'FIELD');
    assert.ok(field, 'the fixture has fields');

    const upward = analyzeImpact(index, field, 2).impacted.find(
      (entry) => entry.node.type === 'ENTITY' && entry.depth === 1,
    );
    assert.ok(upward, 'a field’s own entity is affected by changing it');
    assert.equal(upward.via, 'CONTAINS');
    assert.equal(upward.direction, 'backward');
    assert.match(upward.reason, /contains the changed node$/);
    assert.doesNotMatch(upward.reason, /is contained by/);

    // The same relationship walked the other way says the other thing.
    const users = find('ENTITY', 'user');
    assert.ok(users);
    const downward = analyzeImpact(index, users, 2).impacted.find(
      (entry) => entry.node.type === 'FIELD' && entry.depth === 1,
    );
    assert.ok(downward);
    assert.equal(downward.direction, 'forward');
    assert.match(downward.reason, /is contained by the changed node$/);
  });

  it('tells a stated relationship from an inferred chain', () => {
    const users = find('ENTITY', 'user');
    assert.ok(users);
    const impact = analyzeImpact(index, users, 3);

    assert.equal(impact.directCount + impact.indirectCount, impact.impacted.length);
    assert.ok(impact.directCount > 0, 'something is one edge away');
    assert.ok(impact.indirectCount > 0, 'something is further away');
    assert.equal(impact.truncated, false, 'this answer fits well inside the cap');

    for (const entry of impact.impacted) {
      assert.equal(entry.direct, entry.depth === 1);
      // An indirect hit must not be worded as a relationship to the origin.
      if (!entry.direct) assert.match(entry.reason, /hops away\)$/);
    }

    // Every direct claim is an edge the graph actually holds, in the
    // direction the entry says it was walked.
    for (const entry of impact.impacted.filter((candidate) => candidate.direct)) {
      const [from, to] =
        entry.direction === 'backward' ? [entry.node.id, users.id] : [users.id, entry.node.id];
      assert.ok(
        edges.some(
          (edge) =>
            edge.relationship === entry.via &&
            edge.sourceNodeId === from &&
            edge.targetNodeId === to,
        ),
        `${entry.node.name} claims an edge the graph does not hold`,
      );
    }
  });

  it('carries each edge’s own evidence onto the hop that used it', () => {
    // An import edge records the specifier that was parsed. Picked from a
    // pair joined by exactly one edge, so the hop cannot have used another.
    const evidenced = edges
      .filter((edge) => typeof (edge.metadata as { specifier?: unknown }).specifier === 'string')
      .find(
        (edge) =>
          edges.filter(
            (other) =>
              other.sourceNodeId === edge.sourceNodeId && other.targetNodeId === edge.targetNodeId,
          ).length === 1,
      );
    assert.ok(evidenced, 'the fixture resolves imports between its own files');

    const path = findPath(index, evidenced.sourceNodeId, evidenced.targetNodeId, 1);
    assert.ok(path);
    assert.equal(path.hops.length, 1);
    assert.deepEqual(path.hops[0]?.metadata, evidenced.metadata);
  });

  it('finds a node by identity as well as by id', () => {
    const lookup = lookupOverNodes(nodes);
    const file = nodes.find((node) => node.type === 'FILE');
    assert.ok(file);

    // The qualified form, the bare path, and a differently-cased path.
    assert.equal(nodeByIdentity(lookup, identityOf('FILE', file.canonicalName))?.id, file.id);
    assert.equal(nodeByIdentity(lookup, file.canonicalName)?.id, file.id);
    assert.equal(nodeByIdentity(lookup, file.canonicalName.toUpperCase())?.id, file.id);

    // A folded name resolves through canonicalization, which is the point of
    // it: the planner's spelling and the generator's reach one node.
    const users = find('ENTITY', 'user');
    assert.ok(users);
    assert.equal(nodeByIdentity(lookup, 'ENTITY::User Service')?.id, users.id);
    assert.equal(nodeByIdentity(lookup, identityOf('ENTITY', 'user'))?.id, users.id);

    // And nothing is invented for a name or a type the graph does not hold.
    assert.equal(nodeByIdentity(lookup, 'ENTITY::nothing-here'), undefined);
    assert.equal(nodeByIdentity(lookup, 'NOT_A_TYPE::user'), undefined);
    assert.equal(nodeByIdentity(lookup, 'a name no artifact used'), undefined);
  });

  it('traces a requirement to the code that implements it, with the path', () => {
    const requirement = nodes.find((node) => node.type === 'REQUIREMENT');
    assert.ok(requirement);
    assert.equal(traceDirectionFor(requirement), 'to-implementation');

    const trace = traceRequirements(index, requirement, 'to-implementation');
    assert.ok(trace.links.length > 0, 'a requirement reaches the code built for it');
    assert.equal(trace.truncated, false);

    const types = new Set(trace.links.map((link) => link.node.type));
    assert.ok(types.has('FEATURE'), 'the feature that implements it');
    assert.ok(types.has('FILE'), 'and the files that come out of that');

    for (const link of trace.links) {
      // Each link shows the chain it is claiming, and the chain is real.
      assert.equal(link.path.nodes[0]?.id, requirement.id);
      assert.equal(link.path.nodes[link.path.nodes.length - 1]?.id, link.node.id);
      assert.equal(link.path.hops.length, link.path.nodes.length - 1);
      assert.equal(link.direct, link.depth === 1);
      for (const node of link.path.nodes) assert.ok(index.nodesById.has(node.id));
      // Nothing is "implemented by" everything else in the project just for
      // sharing the root or a directory with it.
      assert.ok(!link.path.nodes.some((node) => node.type === 'PROJECT'));
      assert.ok(!link.path.nodes.some((node) => node.type === 'FOLDER'));
    }
  });

  it('traces a file back to the requirement it serves', () => {
    const file = nodes.find(
      (node) => node.type === 'FILE' && node.canonicalName.includes('.service.ts'),
    );
    assert.ok(file, 'the backend has service files');
    assert.equal(traceDirectionFor(file), 'to-requirements');

    const trace = traceRequirements(index, file, 'to-requirements');
    assert.ok(trace.links.length > 0, 'a service file serves a requirement');
    assert.ok(trace.links.every((link) => link.node.type === 'REQUIREMENT'));
    for (const link of trace.links) {
      assert.equal(link.path.nodes[0]?.id, file.id);
      assert.ok(link.path.hops.length > 0);
    }
  });

  it('uses only declared relationship names', () => {
    const allowed = new Set<GraphRelationship>([
      'CONTAINS',
      'IMPLEMENTS',
      'DEPENDS_ON',
      'USES',
      'CALLS',
      'EXPOSES',
      'PERSISTS',
      'BELONGS_TO',
      'GENERATES',
      'VALIDATES',
      'TESTS',
      'SECURED_BY',
    ]);
    assert.ok(edges.every((edge) => allowed.has(edge.relationship)));
  });
});

describe('graph builder (different domain)', () => {
  it('produces a different graph for a different requirement', () => {
    const ecommerce = buildGraph(
      buildArtifacts('Build an e-commerce platform with products, cart, orders and payments.'),
    );
    const clinic = buildGraph(
      buildArtifacts(
        'Build a clinic system with authentication, patients, doctors, appointments and prescriptions.',
      ),
    );

    const entities = (draft: ReturnType<typeof buildGraph>) =>
      draft.nodes
        .filter((n) => n.type === 'ENTITY')
        .map((n) => n.canonicalName)
        .sort();

    assert.notDeepEqual(
      entities(ecommerce),
      entities(clinic),
      'the graph must reflect the prompt, not a template',
    );
    assert.ok(entities(clinic).includes('patient'));
    assert.ok(entities(ecommerce).includes('product'));
  });
});

/* ── Hand-built graphs ────────────────────────────────────────────────── */

const WHEN = '2026-01-01T00:00:00.000Z';

/**
 * A node of a shape the deterministic generators do not produce. Used only
 * for the checks that are about a graph going wrong — a real run cannot be
 * made to produce a stale node or an orphan on demand.
 */
function makeNode(id: string, type: GraphNodeType, over: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    projectId: 'p1',
    runId: 'r1',
    type,
    canonicalName: id,
    name: id,
    description: null,
    metadata: {},
    sourceArtifactId: 'database-design',
    createdAt: WHEN,
    updatedAt: WHEN,
    ...over,
  };
}

function makeEdge(
  id: string,
  sourceNodeId: string,
  targetNodeId: string,
  relationship: GraphRelationship = 'CONTAINS',
  metadata: Record<string, unknown> = {},
): GraphEdge {
  return {
    id,
    projectId: 'p1',
    runId: 'r1',
    sourceNodeId,
    targetNodeId,
    relationship,
    metadata,
    createdAt: WHEN,
  };
}

describe('traversal bounds', () => {
  const nodes = [
    makeNode('project', 'PROJECT'),
    makeNode('hub', 'ENTITY'),
    makeNode('far', 'ENTITY'),
    makeNode('a', 'FIELD'),
    makeNode('b', 'FIELD'),
    makeNode('c', 'FIELD'),
  ];
  const edges = [
    makeEdge('e1', 'hub', 'a'),
    makeEdge('e2', 'hub', 'b'),
    makeEdge('e3', 'hub', 'c'),
    makeEdge('e4', 'project', 'hub'),
    makeEdge('e5', 'project', 'far'),
  ];
  const index = indexGraph(nodes, edges);

  it('does not call a complete answer truncated, even at exactly the cap', () => {
    // Three children, a cap of three. Reporting this as truncated would send
    // a caller looking for results that do not exist.
    const result = traverseBounded(index, 'hub', 'outgoing', { limit: 3 });
    assert.equal(result.related.length, 3);
    assert.equal(result.truncated, false);
    assert.equal(result.limit, 3);
  });

  it('says so when the cap stopped the walk', () => {
    const result = traverseBounded(index, 'hub', 'outgoing', { limit: 2 });
    assert.equal(result.related.length, 2);
    assert.equal(result.truncated, true);
  });

  it('refuses to walk through an excluded type', () => {
    // Everything is reachable through the project root, which is why a trace
    // is not allowed to pass through it.
    const through = traverseBounded(index, 'hub', 'both', { maxDepth: 3 });
    assert.ok(through.related.some((related) => related.node.id === 'far'));

    const pruned = traverseBounded(index, 'hub', 'both', {
      maxDepth: 3,
      excludeNodeTypes: ['PROJECT'],
    });
    assert.ok(!pruned.related.some((related) => related.node.id === 'far'));
    assert.ok(!pruned.related.some((related) => related.node.type === 'PROJECT'));

    assert.equal(findPath(index, 'hub', 'far', 4, 'any')?.nodes.length, 3);
    assert.equal(findPath(index, 'hub', 'far', 4, 'any', { excludeNodeTypes: ['PROJECT'] }), null);
  });
});

describe('impact analysis bounds', () => {
  it('says when the answer was capped rather than letting it read as complete', () => {
    // 450 dependants against a cap of 400: a change here affects more than
    // one answer can carry, and that is the one thing it must not hide.
    const target = makeNode('target', 'SERVICE');
    const callers = Array.from({ length: 450 }, (_unused, i) =>
      makeNode(`caller${String(i)}`, 'API'),
    );
    const edges = callers.map((caller, i) =>
      makeEdge(`e${String(i)}`, caller.id, target.id, 'USES'),
    );

    const impact = analyzeImpact(indexGraph([target, ...callers], edges), target, 3);
    assert.equal(impact.truncated, true);
    assert.equal(impact.impacted.length, 400);
    assert.equal(impact.directCount, 400);
    assert.equal(impact.indirectCount, 0);
  });
});

describe('review findings in the graph', () => {
  const analysis = analyzeRequirements('Build a blog with posts, comments and authentication.');
  assert.equal(analysis.status, 'COMPLETE');
  const files = [
    { path: 'backend/src/app.ts', content: "import './util.js';\n" },
    { path: 'backend/src/util.ts', content: 'export const x = 1;\n' },
  ];
  const finding = (over: Partial<ReviewFindingDraft>): ReviewFindingDraft => ({
    id: 'f',
    type: 'CODE',
    severity: 'HIGH',
    category: 'correctness',
    title: 'Something to look at',
    description: 'details',
    status: 'OPEN',
    confidence: 0.9,
    agentId: 'reviewer',
    targetFile: null,
    targetNodeId: null,
    ...over,
  });

  const draft = buildGraph({
    requirements: analysis.spec,
    files,
    findings: [
      finding({ id: 'by-file', title: 'Unawaited promise', targetFile: 'backend/src/app.ts' }),
      finding({
        id: 'by-identity',
        title: 'Named a node',
        targetNodeId: 'FILE::backend/src/util.ts',
      }),
      finding({
        id: 'unresolved',
        title: 'Ghost',
        targetNodeId: 'ENTITY::nothing-here',
        targetFile: 'backend/src/gone.ts',
      }),
    ],
  });
  const { nodes, edges } = materialize(draft);

  const findingNode = (id: string): GraphNode | undefined =>
    nodes.find((node) => node.type === 'FINDING' && node.canonicalName === `finding:${id}`);

  it('gives every FOLDER and FINDING node an edge, as the orphan rule assumes', () => {
    const connected = new Set(edges.flatMap((edge) => [edge.sourceNodeId, edge.targetNodeId]));
    const leaves = nodes.filter((node) => node.type === 'FOLDER' || node.type === 'FINDING');
    assert.equal(nodes.filter((node) => node.type === 'FINDING').length, 3);
    assert.ok(
      nodes.some((node) => node.type === 'FOLDER'),
      'the file tree produced folders',
    );
    for (const node of leaves) {
      assert.ok(connected.has(node.id), `${node.type} "${node.name}" has no edge`);
    }
    assert.deepEqual(
      validateGraph(nodes, edges).issues.filter((issue) => issue.kind === 'orphan-node'),
      [],
    );
  });

  it('targets the file a finding names, and the node a review agent named', () => {
    const targetsOf = (id: string) =>
      edges
        .filter(
          (edge) => edge.relationship === 'TARGETS' && edge.sourceNodeId === findingNode(id)?.id,
        )
        .map((edge) => edge.targetNodeId);

    assert.deepEqual(targetsOf('by-file'), ['FILE::backend/src/app.ts']);
    assert.deepEqual(targetsOf('by-identity'), ['FILE::backend/src/util.ts']);
    // A stated target the graph cannot match gets no edge at all: a guessed
    // link would be worse than none.
    assert.deepEqual(targetsOf('unresolved'), []);
  });

  it('writes down the target it could not resolve', () => {
    const ghost = findingNode('unresolved');
    assert.ok(ghost);
    assert.deepEqual(ghost.metadata.unresolvedTargetNodeId, {
      targetNodeId: 'ENTITY::nothing-here',
      reason: 'no node in this graph has this identity',
    });
    // A finding that named nothing records nothing, so the two cases stay
    // distinguishable.
    assert.equal(findingNode('by-file')?.metadata.unresolvedTargetNodeId, undefined);
  });

  it('reports the unresolved target and the unknown file as diagnostics', () => {
    const report = validateGraph(nodes, edges);
    const kinds = report.issues.map((issue) => issue.kind);
    assert.ok(kinds.includes('unresolved-finding-target'));
    assert.ok(kinds.includes('missing-file-reference'));
    assert.ok(report.valid, 'both are worth saying, neither makes the graph wrong');

    const missing = report.issues.find((issue) => issue.kind === 'missing-file-reference');
    assert.match(missing?.message ?? '', /backend\/src\/gone\.ts/);
    assert.deepEqual(missing?.nodeIds, [findingNode('unresolved')?.id]);
  });
});

describe('unresolved requirement links', () => {
  // The e-commerce prompt, as the rest of this file uses: the deterministic
  // analyzer reports the task-tracker wording INCOMPLETE, and buildArtifacts
  // asserts a complete fixture. Nothing in this suite depends on the domain —
  // only on a module name that resolves to no requirement.
  const artifacts = buildArtifacts(
    'Build an e-commerce platform with products, cart, orders and payments.',
  );
  const draft = buildGraph({
    ...artifacts,
    architecture: {
      ...artifacts.architecture,
      // A feature nothing in the spec asked for, which is what an
      // unresolvable requirement name looks like in practice.
      apiModules: [
        ...artifacts.architecture.apiModules,
        { module: 'Quantum Telemetry', basePath: '/api/v1/quantum', endpoints: [] },
      ],
    },
  });

  it('records the name a feature could not resolve, rather than nothing', () => {
    const feature = draft.nodes.find(
      (node) => node.type === 'FEATURE' && node.canonicalName === canonicalize('Quantum Telemetry'),
    );
    assert.ok(feature);
    assert.deepEqual(feature.metadata?.unresolvedRequirements, {
      reason: 'no REQUIREMENT node has this canonical name',
      names: ['Quantum Telemetry'],
    });
    assert.ok(
      !draft.edges.some(
        (edge) =>
          edge.relationship === 'IMPLEMENTS' &&
          edge.from.type === 'FEATURE' &&
          edge.from.canonicalName === feature.canonicalName,
      ),
      'no requirement matched, so there is no edge to show',
    );
  });

  it('surfaces it as a diagnostic instead of leaving it in metadata nobody reads', () => {
    const { nodes, edges } = materialize(draft);
    const issue = validateGraph(nodes, edges).issues.find(
      (candidate) => candidate.kind === 'unresolved-requirement-link',
    );
    assert.ok(issue, 'the builder recorded the miss; the report has to say so');
    assert.match(issue.message, /Quantum Telemetry/);
  });
});

describe('the file-tree cap', () => {
  it('reports the cap rather than silently applying it', () => {
    const analysis = analyzeRequirements('Build a blog with posts, comments and authentication.');
    assert.equal(analysis.status, 'COMPLETE');
    const draft = buildGraph({
      requirements: analysis.spec,
      files: Array.from({ length: 1_600 }, (_unused, i) => ({
        path: `src/file${String(i)}.ts`,
        content: 'export const x = 1;\n',
      })),
    });

    assert.equal(draft.nodes.filter((node) => node.type === 'FILE').length, 1_500);
    const project = draft.nodes.find((node) => node.type === 'PROJECT');
    assert.deepEqual(project?.metadata?.fileTreeCap, {
      cap: 1_500,
      totalFiles: 1_600,
      reason: 'the file tree was capped, so this graph does not map every file',
    });

    const { nodes, edges } = materialize(draft);
    const issue = validateGraph(nodes, edges).issues.find(
      (candidate) => candidate.kind === 'truncated-file-tree',
    );
    assert.ok(issue, 'a graph that maps part of the project must say so');
    assert.match(issue.message, /1500 of 1600/);
  });

  it('says nothing when every file fits', () => {
    const analysis = analyzeRequirements('Build a blog with posts, comments and authentication.');
    assert.equal(analysis.status, 'COMPLETE');
    const draft = buildGraph({
      requirements: analysis.spec,
      files: [{ path: 'src/index.ts', content: 'export const x = 1;\n' }],
    });
    const project = draft.nodes.find((node) => node.type === 'PROJECT');
    assert.equal(project?.metadata?.fileTreeCap, undefined);
  });
});

describe('graph validation', () => {
  const base: GraphNode = makeNode('n1', 'ENTITY', { canonicalName: 'order', name: 'Orders' });
  const other: GraphNode = makeNode('n2', 'ENTITY', { canonicalName: 'user', name: 'Users' });
  const edge = (over: Partial<GraphEdge>): GraphEdge => ({
    ...makeEdge('e1', 'n1', 'n2', 'BELONGS_TO'),
    ...over,
  });

  it('reports an edge whose endpoint this graph does not contain as an error', () => {
    const report = validateGraph([base], [edge({})]);
    assert.equal(report.valid, false);
    assert.equal(report.issues[0]?.kind, 'dangling-edge');
  });

  /**
   * Three checks used to be advertised that no writer in this system can
   * trip: the unique index on (source, target, relationship) forbids a
   * duplicate, the enum column forbids an unknown relationship, and the
   * builder refuses to draft a self-loop. A report that lists checks which
   * cannot fail reads as thorough while saying nothing.
   */
  it('no longer advertises the checks that cannot fire', () => {
    const report = validateGraph(
      [base, other],
      [
        edge({ id: 'e1' }),
        edge({ id: 'e2' }),
        edge({ id: 'e3', relationship: 'USES', sourceNodeId: 'n1', targetNodeId: 'n1' }),
      ],
    );
    const kinds: string[] = report.issues.map((issue) => issue.kind);
    assert.ok(!kinds.includes('duplicate-edge'));
    assert.ok(!kinds.includes('invalid-relationship'));
    assert.ok(!kinds.includes('self-loop'));
    assert.ok(report.valid);
  });

  it('flags a containment cycle but does not call the graph invalid', () => {
    const report = validateGraph(
      [base, other],
      [
        edge({ id: 'e1', relationship: 'CONTAINS', sourceNodeId: 'n1', targetNodeId: 'n2' }),
        edge({ id: 'e2', relationship: 'CONTAINS', sourceNodeId: 'n2', targetNodeId: 'n1' }),
      ],
    );
    assert.ok(report.issues.some((issue) => issue.kind === 'suspicious-cycle'));
    assert.ok(report.valid);
  });

  it('leaves a USES cycle alone — mutual coupling is not a defect', () => {
    const report = validateGraph(
      [base, other],
      [
        edge({ id: 'e1', relationship: 'USES', sourceNodeId: 'n1', targetNodeId: 'n2' }),
        edge({ id: 'e2', relationship: 'USES', sourceNodeId: 'n2', targetNodeId: 'n1' }),
      ],
    );
    assert.ok(!report.issues.some((issue) => issue.kind === 'suspicious-cycle'));
  });

  /**
   * The old rule exempted six "leaf" types from the orphan check and omitted
   * FOLDER and FINDING, so a field with no entity passed silently while every
   * folder in every graph was reported. The builder gives every node it emits
   * an edge, so the rule is simply that — except for the root.
   */
  it('flags any disconnected node but the project root', () => {
    const loose = [
      makeNode('root', 'PROJECT'),
      makeNode('field', 'FIELD'),
      makeNode('api', 'API'),
      makeNode('dependency', 'DEPENDENCY'),
      makeNode('folder', 'FOLDER'),
      makeNode('finding', 'FINDING'),
    ];
    const orphans = validateGraph(loose, []).issues.filter((issue) => issue.kind === 'orphan-node');
    assert.deepEqual(orphans.flatMap((issue) => issue.nodeIds).sort(), [
      'api',
      'dependency',
      'field',
      'finding',
      'folder',
    ]);
  });

  it('counts stale nodes against the latest completed build, in one issue', () => {
    const nodes = [
      makeNode('fresh', 'ENTITY'),
      makeNode('old', 'ENTITY', { runId: 'r0' }),
      makeNode('older', 'ENTITY', { runId: 'r0' }),
    ];
    const connecting = [makeEdge('e1', 'fresh', 'old'), makeEdge('e2', 'fresh', 'older')];

    const report = validateGraph(nodes, connecting, { latestRunId: 'r1' });
    const stale = report.issues.filter((issue) => issue.kind === 'stale-node');
    assert.equal(stale.length, 1, 'one issue that counts them, not one per node');
    const [issue] = stale;
    assert.ok(issue);
    assert.deepEqual(issue.nodeIds, ['old', 'older']);
    assert.equal(issue.severity, 'info');
    assert.ok(!report.skippedChecks.includes('stale-node'));
  });

  it('skips the staleness check rather than passing it when no run is known', () => {
    const report = validateGraph([makeNode('old', 'ENTITY', { runId: 'r0' })], []);
    assert.ok(!report.issues.some((issue) => issue.kind === 'stale-node'));
    assert.ok(
      report.skippedChecks.includes('stale-node'),
      'a check that could not run must not look like one that passed',
    );
  });

  it('will not call a file reference missing when the graph holds no files', () => {
    const finding = makeNode('finding', 'FINDING', {
      metadata: { targetFile: 'backend/src/app.ts' },
    });
    const report = validateGraph([finding], []);
    assert.ok(!report.issues.some((issue) => issue.kind === 'missing-file-reference'));
    assert.ok(report.skippedChecks.includes('missing-file-reference'));

    // With a file tree to check against, the same node is a real finding.
    const file = makeNode('file', 'FILE', { canonicalName: 'backend/src/other.ts' });
    const withTree = validateGraph([finding, file], [makeEdge('e1', 'file', 'finding')]);
    assert.ok(withTree.issues.some((issue) => issue.kind === 'missing-file-reference'));
    assert.ok(!withTree.skippedChecks.includes('missing-file-reference'));
  });
});

/**
 * Paths must not route through a structural container.
 *
 * Every node is CONTAINS-reachable from PROJECT, and files hang off FOLDER,
 * so an undirected search finds a route between almost any two nodes by
 * going up to the root and back down. Shown as "how this requirement
 * reaches that file", such a route is a lie dressed as evidence: it proves
 * only that both belong to the same project.
 */
describe('trace paths exclude structural containers', () => {
  const artifacts = buildArtifacts(
    'Build an e-commerce platform with products, cart, orders and payments.',
  );
  const draft = buildGraph(artifacts);
  // `materialize`, as the rest of this file does: a draft's edges name their
  // endpoints by identity, and only materializing gives them the node ids a
  // traversal needs.
  const { nodes, edges } = materialize(draft);
  const index = indexGraph(nodes, edges);

  const byType = (type: GraphNodeType): GraphNode[] => nodes.filter((node) => node.type === type);

  it('refuses a route that only exists by way of PROJECT or FOLDER', () => {
    const requirement = byType('REQUIREMENT')[0];
    const file = byType('FILE').find(
      (node) => node.name.endsWith('.ts') || node.name.endsWith('.tsx'),
    );
    assert.ok(requirement && file);

    const containers: GraphNodeType[] = ['PROJECT', 'FOLDER'];
    const exclude = containers.filter((type) => type !== requirement.type && type !== file.type);
    const path = findPath(index, requirement.id, file.id, 6, 'any', { excludeNodeTypes: exclude });

    if (path !== null) {
      // A path is fine — what is not fine is one that hops through a
      // container, which is the shape that proves nothing.
      for (const node of path.nodes) {
        assert.ok(!containers.includes(node.type), `the chain must not pass through ${node.type}`);
      }
    }
  });

  it('still allows a container as an endpoint', () => {
    // Excluding them outright would break "where does this folder sit",
    // which is a legitimate question.
    const folder = byType('FOLDER')[0];
    const project = byType('PROJECT')[0];
    assert.ok(folder && project);
    const path = findPath(index, project.id, folder.id, 6, 'any', { excludeNodeTypes: [] });
    assert.ok(path, 'a path to a folder is still answerable');
  });
});
