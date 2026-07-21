import { Maximize2, Search, ZoomIn, ZoomOut } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react';

import { Badge } from '@/shared/components/ui/badge';
import { Input } from '@/shared/components/ui/input';
import { cn } from '@/shared/lib/cn';
import type { DependencyGraph, GraphLayout, ModuleGroup } from '@/shared/types/api';

const NODE_W = 200;
const NODE_H = 64;
const MIN_SCALE = 0.25;
const MAX_SCALE = 2.5;

interface Transform {
  x: number;
  y: number;
  scale: number;
}

export interface GraphCanvasProps {
  graph: DependencyGraph;
  layout: GraphLayout;
  /** Nodes to emphasize as "affected by this change" (from an impact simulation), styled distinctly from search/selection. */
  impactNodeIds?: ReadonlySet<string>;
  height?: number;
}

function useDrag(onDelta: (dx: number, dy: number) => void) {
  const last = useRef<{ x: number; y: number } | null>(null);

  return {
    onPointerDown: (event: ReactPointerEvent<SVGSVGElement>) => {
      last.current = { x: event.clientX, y: event.clientY };
      (event.target as Element).setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: ReactPointerEvent<SVGSVGElement>) => {
      if (!last.current) return;
      const dx = event.clientX - last.current.x;
      const dy = event.clientY - last.current.y;
      last.current = { x: event.clientX, y: event.clientY };
      onDelta(dx, dy);
    },
    onPointerUp: () => {
      last.current = null;
    },
  };
}

export function GraphCanvas({ graph, layout, impactNodeIds, height = 560 }: GraphCanvasProps) {
  const [transform, setTransform] = useState<Transform>({ x: 40, y: 20, scale: 0.85 });
  const [query, setQuery] = useState('');
  const [hiddenGroups, setHiddenGroups] = useState<Set<ModuleGroup>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const containerRef = useRef<SVGSVGElement>(null);

  const nodeById = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph.nodes]);
  const layoutById = useMemo(() => new Map(layout.nodes.map((n) => [n.id, n])), [layout.nodes]);

  const neighbors = useMemo(() => {
    if (!selectedId) return null;
    const set = new Set<string>([selectedId]);
    const edgeIds = new Set<string>();
    for (const edge of layout.edges) {
      if (edge.from === selectedId) {
        set.add(edge.to);
        edgeIds.add(edge.id);
      } else if (edge.to === selectedId) {
        set.add(edge.from);
        edgeIds.add(edge.id);
      }
    }
    return { nodes: set, edges: edgeIds };
  }, [selectedId, layout.edges]);

  const searchMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return new Set(graph.nodes.filter((n) => n.label.toLowerCase().includes(q)).map((n) => n.id));
  }, [query, graph.nodes]);

  const drag = useDrag((dx, dy) => {
    setTransform((t) => ({ ...t, x: t.x + dx, y: t.y + dy }));
  });

  function zoomBy(factor: number) {
    setTransform((t) => ({
      ...t,
      scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, t.scale * factor)),
    }));
  }

  function onWheel(event: ReactWheelEvent<SVGSVGElement>) {
    event.preventDefault();
    zoomBy(event.deltaY < 0 ? 1.08 : 0.93);
  }

  function resetView() {
    setTransform({ x: 40, y: 20, scale: 0.85 });
    setSelectedId(null);
  }

  function toggleGroup(group: ModuleGroup) {
    setHiddenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }

  const visibleNodeIds = new Set(
    layout.nodes.filter((n) => !hiddenGroups.has(n.group)).map((n) => n.id),
  );

  return (
    <div className="rounded-lg border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="relative w-56">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-subtle" />
          <Input
            type="search"
            placeholder="Search nodes"
            aria-label="Search nodes"
            className="pl-8"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {layout.groups.map((group) => (
            <button
              key={group.id}
              type="button"
              onClick={() => {
                toggleGroup(group.id);
              }}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 font-mono text-2xs uppercase',
                hiddenGroups.has(group.id)
                  ? 'border-line text-fg-subtle opacity-50'
                  : 'border-line-strong text-fg',
              )}
            >
              <span className="size-2 rounded-full" style={{ backgroundColor: group.color }} />
              {group.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => {
              zoomBy(0.85);
            }}
            className="flex size-7 items-center justify-center rounded-sm border border-line text-fg-muted hover:bg-raised hover:text-fg"
          >
            <ZoomOut className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => {
              zoomBy(1.15);
            }}
            className="flex size-7 items-center justify-center rounded-sm border border-line text-fg-muted hover:bg-raised hover:text-fg"
          >
            <ZoomIn className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label="Reset view"
            onClick={resetView}
            className="flex size-7 items-center justify-center rounded-sm border border-line text-fg-muted hover:bg-raised hover:text-fg"
          >
            <Maximize2 className="size-3.5" />
          </button>
        </div>
      </div>

      <svg
        ref={containerRef}
        role="img"
        aria-label="Project dependency graph"
        width="100%"
        height={height}
        className="cursor-grab touch-none active:cursor-grabbing"
        onWheel={onWheel}
        {...drag}
      >
        <defs>
          <marker
            id="graph-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" className="fill-line-strong" />
          </marker>
        </defs>
        <rect x={0} y={0} width="100%" height="100%" fill="transparent" />
        <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.scale})`}>
          {layout.groups.map((group) => (
            <g key={group.id} opacity={hiddenGroups.has(group.id) ? 0.15 : 1}>
              <rect
                x={group.x}
                y={group.y}
                width={group.width}
                height={group.height}
                rx={12}
                fill={group.color}
                fillOpacity={0.06}
                stroke={group.color}
                strokeOpacity={0.35}
              />
              <text x={group.x + 16} y={group.y + 28} className="fill-fg-muted text-xs font-medium">
                {group.label}
              </text>
            </g>
          ))}

          {layout.edges.map((edge) => {
            const from = layoutById.get(edge.from);
            const to = layoutById.get(edge.to);
            if (!from || !to) return null;
            if (!visibleNodeIds.has(edge.from) || !visibleNodeIds.has(edge.to)) return null;

            const emphasized = neighbors?.edges.has(edge.id) ?? false;
            const dim = selectedId !== null && !emphasized;

            const x1 = from.x + NODE_W;
            const y1 = from.y + NODE_H / 2;
            const x2 = to.x;
            const y2 = to.y + NODE_H / 2;

            return (
              <line
                key={edge.id}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                markerEnd="url(#graph-arrow)"
                className={cn(
                  'stroke-line-strong transition-opacity',
                  emphasized && 'stroke-accent',
                  dim && 'opacity-10',
                )}
                strokeWidth={emphasized ? 1.75 : 1}
              />
            );
          })}

          {layout.nodes.map((layoutNode) => {
            if (!visibleNodeIds.has(layoutNode.id)) return null;
            const node = nodeById.get(layoutNode.id);
            if (!node) return null;

            const isSelected = selectedId === node.id;
            const isNeighbor = neighbors?.nodes.has(node.id) ?? false;
            const isSearchMatch = searchMatches?.has(node.id) ?? false;
            const isImpacted = impactNodeIds?.has(node.id) ?? false;
            const dim =
              (selectedId !== null && !isNeighbor) || (searchMatches !== null && !isSearchMatch);

            return (
              <g
                key={node.id}
                transform={`translate(${layoutNode.x}, ${layoutNode.y})`}
                className={cn('cursor-pointer transition-opacity', dim && 'opacity-20')}
                onClick={(event) => {
                  event.stopPropagation();
                  setSelectedId((current) => (current === node.id ? null : node.id));
                }}
              >
                <rect
                  width={NODE_W}
                  height={NODE_H}
                  rx={8}
                  className={cn(
                    'fill-raised stroke-line',
                    isSelected && 'stroke-accent',
                    isImpacted && 'fill-ember-soft stroke-ember',
                  )}
                  strokeWidth={isSelected || isImpacted ? 2 : 1}
                />
                <rect
                  x={0}
                  y={0}
                  width={4}
                  height={NODE_H}
                  rx={2}
                  fill={groupColor(node.group, layout)}
                />
                <text x={14} y={24} className="fill-fg text-xs font-medium">
                  {truncate(node.label, 22)}
                </text>
                <text x={14} y={42} className="fill-fg-subtle font-mono text-[0.65rem] uppercase">
                  {node.type}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      {selectedId && nodeById.get(selectedId) && (
        <div className="flex items-center gap-2 border-t border-line px-4 py-2.5 text-xs text-fg-muted">
          <Badge variant="accent">{nodeById.get(selectedId)?.type}</Badge>
          <span className="font-medium text-fg">{nodeById.get(selectedId)?.label}</span>
          {nodeById.get(selectedId)?.file && (
            <span className="font-mono text-2xs text-fg-subtle">
              {nodeById.get(selectedId)?.file}
            </span>
          )}
          <span className="ml-auto text-2xs text-fg-subtle">
            {neighbors ? neighbors.nodes.size - 1 : 0} direct connection(s)
          </span>
        </div>
      )}
    </div>
  );
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function groupColor(group: ModuleGroup, layout: GraphLayout): string {
  return layout.groups.find((g) => g.id === group)?.color ?? '#64748b';
}
