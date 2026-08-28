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
} from './lib/graph-queries.js';
import { analyzeImpact } from './lib/impact-analysis.js';
import { validateGraph } from './lib/graph-validator.js';
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
    const fields = childrenOf(index, users.id).filter((r) => r.node.type === 'FIELD');
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
    assert.ok(deps.length > 0, 'Orders should depend on the entities it references');

    // Dependents: what points at Orders (its service, its fields' owner).
    const dependents = dependentsOf(index, orders.id);
    assert.ok(dependents.length > 0, 'something should depend on Orders');
    const dependentIds = new Set(dependents.map((d) => d.node.id));
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

describe('graph validation', () => {
  const base: GraphNode = {
    id: 'n1',
    projectId: 'p1',
    runId: 'r1',
    type: 'ENTITY',
    canonicalName: 'order',
    name: 'Orders',
    description: null,
    metadata: {},
    sourceArtifactId: 'database-design',
    createdAt: '',
    updatedAt: '',
  };
  const other: GraphNode = { ...base, id: 'n2', canonicalName: 'user', name: 'Users' };

  const edge = (over: Partial<GraphEdge>): GraphEdge => ({
    id: 'e1',
    projectId: 'p1',
    runId: 'r1',
    sourceNodeId: 'n1',
    targetNodeId: 'n2',
    relationship: 'BELONGS_TO',
    metadata: {},
    createdAt: '',
    ...over,
  });

  it('reports a dangling edge as an error', () => {
    const report = validateGraph([base], [edge({})]);
    assert.equal(report.valid, false);
    assert.equal(report.issues[0]?.kind, 'dangling-edge');
  });

  it('reports a duplicate edge as a warning, not an error', () => {
    const report = validateGraph([base, other], [edge({}), edge({ id: 'e2' })]);
    assert.ok(report.issues.some((issue) => issue.kind === 'duplicate-edge'));
    assert.ok(report.valid, 'a duplicate is worth flagging, not failing');
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
});
