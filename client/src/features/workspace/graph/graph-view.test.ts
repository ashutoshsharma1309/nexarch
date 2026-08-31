/**
 * Tests for the graph's view logic.
 *
 * What is worth testing here is the part with real failure modes: which
 * nodes a mode shows, whether an edge can survive its endpoint being
 * filtered out, and whether a layout places every node it was given. The
 * rendering itself is React Flow's, and re-testing that it draws a div
 * would test the library rather than this code.
 */
import { describe, expect, it } from 'vitest';

import { layoutGraph } from './layouts';
import { applyView, neighboursOf, viewMode } from './view-modes';
import { FAMILY_OF, densityTier } from './node-style';
import { artifactTarget } from './artifact-links';
import type { EngGraphEdge, EngGraphNode, EngNodeType } from '@/shared/types/api';

function node(id: string, type: EngNodeType, name = id): EngGraphNode {
  return {
    id,
    projectId: 'p1',
    runId: 'r1',
    type,
    canonicalName: name.toLowerCase(),
    name,
    description: null,
    metadata: {},
    sourceArtifactId: null,
    createdAt: '',
    updatedAt: '',
  };
}

function edge(id: string, source: string, target: string): EngGraphEdge {
  return {
    id,
    projectId: 'p1',
    runId: 'r1',
    sourceNodeId: source,
    targetNodeId: target,
    relationship: 'USES',
    metadata: {},
    createdAt: '',
  };
}

const NODES = [
  node('n1', 'PROJECT', 'Shop'),
  node('n2', 'SERVICE', 'OrderService'),
  node('n3', 'ENTITY', 'Orders'),
  node('n4', 'FIELD', 'Orders.total'),
  node('n5', 'DEPENDENCY', 'express'),
];
const EDGES = [edge('e1', 'n1', 'n2'), edge('e2', 'n2', 'n3'), edge('e3', 'n3', 'n4')];

describe('view modes', () => {
  it('shows the architectural spine by default and hides leaf detail', () => {
    const view = applyView(NODES, EDGES, { mode: 'architecture' });
    const types = view.nodes.map((n) => n.type);
    expect(types).toContain('SERVICE');
    expect(types).toContain('ENTITY');
    // Columns and packages are the noise the default view exists to omit.
    expect(types).not.toContain('FIELD');
    expect(types).not.toContain('DEPENDENCY');
    expect(view.hiddenCount).toBe(2);
  });

  it('drops edges whose endpoint was filtered out', () => {
    // n3 -> n4 must not survive when n4 is hidden, or it renders as a line
    // into empty space.
    const view = applyView(NODES, EDGES, { mode: 'architecture' });
    const ids = new Set(view.nodes.map((n) => n.id));
    expect(view.edges.every((e) => ids.has(e.sourceNodeId) && ids.has(e.targetNodeId))).toBe(true);
    expect(view.edges.map((e) => e.id)).not.toContain('e3');
  });

  it('the everything view hides nothing', () => {
    const view = applyView(NODES, EDGES, { mode: 'all' });
    expect(view.nodes).toHaveLength(NODES.length);
    expect(view.edges).toHaveLength(EDGES.length);
    expect(view.hiddenCount).toBe(0);
  });

  it('database mode brings fields back', () => {
    const view = applyView(NODES, EDGES, { mode: 'database' });
    expect(view.nodes.map((n) => n.type)).toContain('FIELD');
  });

  it('search matches name and type, and keeps neighbours for context', () => {
    const view = applyView(NODES, EDGES, { mode: 'all', search: 'orderservice' });
    const names = view.nodes.map((n) => n.name);
    expect(names).toContain('OrderService');
    // A lone matching dot is useless; its immediate neighbours come too.
    expect(names).toContain('Shop');
    expect(names).toContain('Orders');
    expect(names).not.toContain('express');
  });

  it('search by type works', () => {
    const view = applyView(NODES, EDGES, { mode: 'all', search: 'dependency' });
    expect(view.nodes.map((n) => n.name)).toContain('express');
  });

  it('returns an empty view rather than throwing when nothing matches', () => {
    const view = applyView(NODES, EDGES, { mode: 'all', search: 'nothing-here' });
    expect(view.nodes).toHaveLength(0);
    expect(view.edges).toHaveLength(0);
  });

  it('falls back to the architecture mode for an unknown id', () => {
    expect(viewMode('bogus' as never).id).toBe('architecture');
  });
});

describe('neighbour highlighting', () => {
  it('collects both directions plus the connecting edges', () => {
    const { nodeIds, edgeIds } = neighboursOf(EDGES, 'n2');
    expect(nodeIds).toEqual(new Set(['n2', 'n1', 'n3']));
    expect(edgeIds).toEqual(new Set(['e1', 'e2']));
  });

  it('a node with no edges highlights only itself', () => {
    expect(neighboursOf(EDGES, 'n5').nodeIds).toEqual(new Set(['n5']));
  });
});

describe('layouts', () => {
  for (const layout of ['hierarchical', 'dependency', 'radial'] as const) {
    it(`${layout} positions every node exactly once`, () => {
      const positions = layoutGraph(NODES, EDGES, layout);
      expect(positions.size).toBe(NODES.length);
      for (const n of NODES) {
        const point = positions.get(n.id);
        expect(point).toBeDefined();
        expect(Number.isFinite(point?.x)).toBe(true);
        expect(Number.isFinite(point?.y)).toBe(true);
      }
    });
  }

  it('survives an edge pointing at a node it was not given', () => {
    // The view layer filters these out, but a layout must not be the thing
    // that crashes if one slips through.
    expect(() =>
      layoutGraph(NODES, [...EDGES, edge('e9', 'n2', 'ghost')], 'hierarchical'),
    ).not.toThrow();
  });

  it('returns nothing for an empty graph instead of failing', () => {
    expect(layoutGraph([], [], 'hierarchical').size).toBe(0);
  });

  it('separates hierarchical layers vertically', () => {
    const positions = layoutGraph(NODES, EDGES, 'hierarchical');
    const project = positions.get('n1');
    const service = positions.get('n2');
    expect(project && service && service.y > project.y).toBe(true);
  });
});

describe('node styling', () => {
  it('assigns every node type to a family', () => {
    const types: EngNodeType[] = [
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
    ];
    for (const type of types) expect(FAMILY_OF[type]).toBeDefined();
  });

  it('buckets relationship density into three tiers', () => {
    expect(densityTier(0)).toBe(0);
    expect(densityTier(4)).toBe(1);
    expect(densityTier(20)).toBe(2);
  });
});

describe('artifact links', () => {
  it('routes each artifact type to a real workspace tab', () => {
    expect(artifactTarget('p1', 'requirement-spec')?.href).toBe('/projects/p1/requirements');
    expect(artifactTarget('p1', 'database-design')?.href).toBe('/projects/p1/database');
    expect(artifactTarget('p1', 'backend-source')?.href).toBe('/projects/p1/code');
  });

  it('returns null rather than a dead link when there is no destination', () => {
    expect(artifactTarget('p1', null)).toBeNull();
    expect(artifactTarget('p1', 'something-unmapped')).toBeNull();
  });
});
