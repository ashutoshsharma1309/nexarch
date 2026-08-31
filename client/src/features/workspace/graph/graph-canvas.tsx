/**
 * The canvas.
 *
 * React Flow handles pan, zoom, drag, selection and fit-to-view; this file
 * is the translation layer between the Engineering Graph and what React
 * Flow wants, plus the highlight behaviour that makes a selection readable.
 *
 * Two things are deliberate:
 *
 *   • Positions are computed from the *visible* subgraph and re-applied
 *     whenever the mode, filter or layout changes — so switching a filter
 *     reflows what is on screen rather than leaving holes where hidden
 *     nodes used to be.
 *
 *   • Selecting a node dims everything that is not its immediate
 *     neighbourhood rather than hiding it. Hiding loses the context that
 *     makes a neighbourhood meaningful; dimming keeps the shape of the
 *     graph while moving focus.
 */
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import type { Edge, Node, NodeMouseHandler } from '@xyflow/react';
import { useCallback, useEffect, useMemo } from 'react';

import type { EngGraphEdge, EngGraphNode } from '@/shared/types/api';
import { GraphNodeCard } from './graph-node';
import type { GraphNodeData } from './graph-node';
import { layoutGraph } from './layouts';
import type { LayoutId } from './layouts';
import { neighboursOf } from './view-modes';

import '@xyflow/react/dist/style.css';

const NODE_TYPES = { engineering: GraphNodeCard };

export interface GraphCanvasProps {
  nodes: EngGraphNode[];
  edges: EngGraphEdge[];
  layout: LayoutId;
  selectedId: string | null;
  /** Nodes an impact query marked as affected — emphasized over normal selection. */
  impactedIds?: ReadonlySet<string>;
  /** Nodes graph validation raised an issue about. */
  flaggedIds?: ReadonlySet<string>;
  onSelect: (nodeId: string | null) => void;
  /** Bumped by the caller to force a re-fit (e.g. the Reset control). */
  fitSignal: number;
}

function CanvasInner({
  nodes,
  edges,
  layout,
  selectedId,
  impactedIds,
  flaggedIds,
  onSelect,
  fitSignal,
}: GraphCanvasProps) {
  const { fitView } = useReactFlow();

  const positions = useMemo(() => layoutGraph(nodes, edges, layout), [nodes, edges, layout]);

  const degrees = useMemo(() => {
    const counts = new Map<string, number>();
    for (const edge of edges) {
      counts.set(edge.sourceNodeId, (counts.get(edge.sourceNodeId) ?? 0) + 1);
      counts.set(edge.targetNodeId, (counts.get(edge.targetNodeId) ?? 0) + 1);
    }
    return counts;
  }, [edges]);

  // What stays bright. Impact results win over a plain selection, because
  // "what does this break" is a more specific question than "what is next
  // to this" and the user asked it explicitly.
  const highlight = useMemo(() => {
    if (impactedIds && impactedIds.size > 0) {
      return { nodeIds: impactedIds, edgeIds: new Set<string>() };
    }
    if (!selectedId) return null;
    return neighboursOf(edges, selectedId);
  }, [edges, selectedId, impactedIds]);

  const flowNodes = useMemo<Node<GraphNodeData>[]>(
    () =>
      nodes.map((node) => ({
        id: node.id,
        type: 'engineering',
        position: positions.get(node.id) ?? { x: 0, y: 0 },
        data: {
          label: node.name,
          nodeType: node.type,
          degree: degrees.get(node.id) ?? 0,
          dimmed: highlight !== null && !highlight.nodeIds.has(node.id),
          selected: node.id === selectedId,
          flagged: Boolean(flaggedIds?.has(node.id)),
        },
        // Dragging is allowed; the layout is a starting point, not a cage.
        draggable: true,
      })),
    [nodes, positions, degrees, highlight, selectedId, flaggedIds],
  );

  const flowEdges = useMemo<Edge[]>(
    () =>
      edges.map((edge) => {
        const active =
          !highlight ||
          highlight.edgeIds.has(edge.id) ||
          (highlight.nodeIds.has(edge.sourceNodeId) && highlight.nodeIds.has(edge.targetNodeId));
        return {
          id: edge.id,
          source: edge.sourceNodeId,
          target: edge.targetNodeId,
          label: active && highlight ? edge.relationship : undefined,
          animated: false,
          style: {
            stroke: active ? 'var(--color-line-strong)' : 'var(--color-line)',
            strokeWidth: active && highlight ? 1.6 : 1,
            opacity: active ? 1 : 0.15,
          },
          labelStyle: {
            fill: 'var(--color-fg-subtle)',
            fontSize: 9,
            fontFamily: 'var(--font-mono, monospace)',
          },
          labelBgStyle: { fill: 'var(--color-canvas)' },
        };
      }),
    [edges, highlight],
  );

  // Re-fit when the visible set changes shape, or when Reset asks.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fitView({ padding: 0.15, duration: 220, maxZoom: 1.2 });
    }, 60);
    return () => {
      window.clearTimeout(timer);
    };
  }, [fitView, layout, nodes.length, fitSignal]);

  const handleNodeClick = useCallback<NodeMouseHandler>(
    (_event, node) => {
      onSelect(node.id === selectedId ? null : node.id);
    },
    [onSelect, selectedId],
  );

  return (
    <ReactFlow
      nodes={flowNodes}
      edges={flowEdges}
      nodeTypes={NODE_TYPES}
      onNodeClick={handleNodeClick}
      onPaneClick={() => {
        onSelect(null);
      }}
      minZoom={0.05}
      maxZoom={2.5}
      nodesConnectable={false}
      elementsSelectable
      // React Flow only renders nodes inside the viewport once this is on —
      // the difference between smooth and unusable at a few hundred nodes.
      onlyRenderVisibleElements
      fitView
      className="bg-canvas"
      aria-label="Engineering graph canvas"
    >
      {/* The React Flow attribution stays visible: the library is MIT, but
          its authors ask that hiding the credit be reserved for Pro. */}
      <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--color-line)" />
      <Controls
        showInteractive={false}
        className="!border !border-line !bg-surface [&>button]:!border-line [&>button]:!bg-surface [&>button]:!fill-current [&>button]:!text-fg-muted hover:[&>button]:!bg-raised"
      />
      <MiniMap
        pannable
        zoomable
        className="!hidden !border !border-line !bg-surface sm:!block"
        maskColor="color-mix(in oklab, var(--color-canvas) 70%, transparent)"
        nodeColor="var(--color-line-strong)"
      />
    </ReactFlow>
  );
}

export function GraphCanvas(props: GraphCanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
