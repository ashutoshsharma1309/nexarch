/**
 * Engineering Graph integration tests (`npm run test:integration`).
 *
 * These need a database because what they check *is* the database: the
 * unique index that makes deduplication a schema guarantee rather than a
 * code convention, the diff that keeps node ids stable across runs, and
 * the ownership filter that stops one user reading another's graph.
 *
 * None of that can be proven against an in-memory fake — a fake would pass
 * whether or not the index exists.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { prisma } from '../../shared/database/prisma.js';
import { syncGraph, loadNodes, loadEdges } from './lib/graph-repository.js';
import { getGraph, getImpact, validate } from './engineering-graph.service.js';
import type { GraphDraft } from '../../shared/contracts/index.js';

const OWNER = 'graph_owner_a';
const INTRUDER = 'graph_owner_b';
let projectId = '';
let otherProjectId = '';

/** A tiny hand-built graph: Order → User, Order → Payment. */
const DRAFT: GraphDraft = {
  nodes: [
    { type: 'ENTITY', canonicalName: 'user', name: 'Users', sourceArtifactId: 'database-design' },
    { type: 'ENTITY', canonicalName: 'order', name: 'Orders', sourceArtifactId: 'database-design' },
    {
      type: 'ENTITY',
      canonicalName: 'payment',
      name: 'Payments',
      sourceArtifactId: 'database-design',
    },
  ],
  edges: [
    {
      from: { type: 'ENTITY', canonicalName: 'order' },
      to: { type: 'ENTITY', canonicalName: 'user' },
      relationship: 'BELONGS_TO',
    },
    {
      from: { type: 'ENTITY', canonicalName: 'order' },
      to: { type: 'ENTITY', canonicalName: 'payment' },
      relationship: 'BELONGS_TO',
    },
  ],
};

before(async () => {
  const role = await prisma.role.upsert({
    where: { name: 'USER' },
    update: {},
    create: { name: 'USER', description: 'Standard platform access' },
  });
  for (const [id, email] of [
    [OWNER, 'graph-a@integration.test'],
    [INTRUDER, 'graph-b@integration.test'],
  ] as const) {
    await prisma.user.upsert({
      where: { id },
      update: {},
      create: { id, email, name: `Graph ${id}`, roleId: role.id },
    });
  }
  await prisma.project.deleteMany({ where: { ownerId: { in: [OWNER, INTRUDER] } } });

  const project = await prisma.project.create({
    data: { ownerId: OWNER, name: 'Graph Test', slug: 'graph-test', status: 'ACTIVE' },
  });
  projectId = project.id;
  const other = await prisma.project.create({
    data: { ownerId: INTRUDER, name: 'Not Yours', slug: 'not-yours', status: 'ACTIVE' },
  });
  otherProjectId = other.id;
});

after(async () => {
  await prisma.project.deleteMany({ where: { ownerId: { in: [OWNER, INTRUDER] } } });
  await prisma.user.deleteMany({ where: { id: { in: [OWNER, INTRUDER] } } });
  await prisma.$disconnect();
});

describe('graph synchronization', () => {
  it('creates nodes and edges on the first sync', async () => {
    const result = await syncGraph(projectId, 'run-1', DRAFT);
    assert.equal(result.nodesCreated, 3);
    assert.equal(result.edgesCreated, 2);
    assert.equal(result.nodeCount, 3);
    assert.equal(result.edgeCount, 2);
  });

  it('is idempotent — re-syncing the same draft changes nothing', async () => {
    const result = await syncGraph(projectId, 'run-1', DRAFT);
    assert.equal(result.nodesCreated, 0);
    assert.equal(result.nodesUpdated, 0);
    assert.equal(result.nodesRemoved, 0);
    assert.equal(result.edgesCreated, 0);
    assert.equal(result.edgesRemoved, 0);
  });

  it('keeps node ids stable across runs so references survive', async () => {
    const before = await loadNodes(projectId);
    await syncGraph(projectId, 'run-2', DRAFT);
    const after = await loadNodes(projectId);

    const idFor = (nodes: typeof before, canonical: string) =>
      nodes.find((node) => node.canonicalName === canonical)?.id;
    for (const canonical of ['user', 'order', 'payment']) {
      assert.equal(idFor(after, canonical), idFor(before, canonical), `${canonical} id changed`);
    }
  });

  it('deduplicates: two spellings of one name never become two nodes', async () => {
    // "user-service" and "User Service" canonicalize identically, so the
    // unique index collapses them regardless of how the draft spells them.
    const withDuplicates: GraphDraft = {
      nodes: [
        ...DRAFT.nodes,
        {
          type: 'SERVICE',
          canonicalName: 'user',
          name: 'UserService',
          sourceArtifactId: 'backend-source',
        },
        {
          type: 'SERVICE',
          canonicalName: 'user',
          name: 'user-service',
          sourceArtifactId: 'backend-source',
        },
      ],
      edges: DRAFT.edges,
    };
    const result = await syncGraph(projectId, 'run-3', withDuplicates);
    assert.equal(result.nodeCount, 4, 'one SERVICE node, not two');

    const services = await loadNodes(projectId, 'SERVICE');
    assert.equal(services.length, 1);
  });

  it('keeps the same canonical name apart when the types differ', async () => {
    const nodes = await loadNodes(projectId);
    const named = nodes.filter((node) => node.canonicalName === 'user');
    assert.equal(named.length, 2, 'ENTITY user and SERVICE user are different nodes');
    assert.deepEqual(new Set(named.map((n) => n.type)), new Set(['ENTITY', 'SERVICE']));
  });

  it('removes what the project no longer contains', async () => {
    const shrunk: GraphDraft = {
      nodes: DRAFT.nodes.filter((node) => node.canonicalName !== 'payment'),
      edges: DRAFT.edges.filter((edge) => edge.to.canonicalName !== 'payment'),
    };
    const result = await syncGraph(projectId, 'run-4', shrunk);
    assert.ok(result.nodesRemoved >= 1, 'the dropped entity is gone');

    const remaining = await loadNodes(projectId);
    assert.ok(!remaining.some((node) => node.canonicalName === 'payment'));

    // Its edge went with it rather than dangling.
    const edges = await loadEdges(projectId);
    const ids = new Set(remaining.map((node) => node.id));
    assert.ok(edges.every((edge) => ids.has(edge.sourceNodeId) && ids.has(edge.targetNodeId)));
  });

  it('answers the dependency question the phase specifies', async () => {
    // Order → User and Order → Payment; asking Order's dependencies must
    // return exactly those two.
    await syncGraph(projectId, 'run-5', DRAFT);
    const graph = await getGraph(OWNER, projectId);
    const order = graph.nodes.find((n) => n.type === 'ENTITY' && n.canonicalName === 'order');
    assert.ok(order);

    const outgoing = graph.edges.filter((edge) => edge.sourceNodeId === order.id);
    const targets = new Set(
      outgoing.map((edge) => graph.nodes.find((n) => n.id === edge.targetNodeId)?.canonicalName),
    );
    assert.deepEqual(targets, new Set(['user', 'payment']));
  });
});

describe('project scoping', () => {
  it('never mixes one project’s nodes into another’s graph', async () => {
    await syncGraph(otherProjectId, 'run-x', {
      nodes: [
        {
          type: 'ENTITY',
          canonicalName: 'secret',
          name: 'Secrets',
          sourceArtifactId: 'database-design',
        },
      ],
      edges: [],
    });

    const mine = await getGraph(OWNER, projectId);
    assert.ok(!mine.nodes.some((node) => node.canonicalName === 'secret'));
    assert.ok(mine.nodes.every((node) => node.projectId === projectId));
  });

  it('refuses every read of another owner’s graph', async () => {
    const notFound = /not found/i;
    await assert.rejects(() => getGraph(INTRUDER, projectId), notFound);
    await assert.rejects(() => validate(INTRUDER, projectId), notFound);

    const mine = await getGraph(OWNER, projectId);
    const node = mine.nodes[0];
    assert.ok(node);
    await assert.rejects(() => getImpact(INTRUDER, projectId, node.id), notFound);
  });

  it('will not resolve a node id that belongs to a different project', async () => {
    const theirs = await loadNodes(otherProjectId);
    const foreign = theirs[0];
    assert.ok(foreign);
    // The owner is legitimate; the node simply is not in this project.
    await assert.rejects(() => getImpact(OWNER, projectId, foreign.id), /does not exist/i);
  });
});

describe('validation over stored data', () => {
  it('reports a clean graph as valid', async () => {
    await syncGraph(projectId, 'run-6', DRAFT);
    const report = await validate(OWNER, projectId);
    assert.equal(report.issues.filter((issue) => issue.severity === 'error').length, 0);
    assert.ok(report.valid);
  });
});
