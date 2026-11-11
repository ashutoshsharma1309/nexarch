/**
 * The Engineering Graph workspace.
 *
 * Composition only: it owns the view state (mode, layout, search,
 * selection) and hands slices of the server's graph to the canvas and the
 * details panel. The graph itself is fetched once per project and cached —
 * every interaction below re-derives from that one copy rather than asking
 * the server again. Node-level traversals (relationships, impact) do go to
 * the server, because those are queries, not filters.
 *
 * View state lives in the URL. A colleague pasting a link to a filtered,
 * radial view of the database with an entity selected gets exactly that,
 * and the back button walks the states rather than leaving the page.
 */
import { AlertTriangle, Hammer, Network, RefreshCw } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { Button } from '@/shared/components/ui/button';
import { Card, CardContent } from '@/shared/components/ui/card';
import { EmptyState } from '@/shared/components/ui/empty-state';
import { Skeleton } from '@/shared/components/ui/skeleton';
import {
  useGraphImpact,
  useGraphValidation,
  useProjectGraph,
  useRefreshGraph,
} from '@/shared/hooks/use-graph';
import { cn } from '@/shared/lib/cn';
import { formatRelativeTime } from '@/shared/lib/format';
import { toast } from '@/shared/store/toast.store';
import { GraphCanvas } from './graph-canvas';
import { GraphHealth } from './graph-health';
import { GraphLegend } from './graph-legend';
import { GraphStats } from './graph-stats';
import { GraphToolbar } from './graph-toolbar';
import { NodeDetails } from './node-details';
import { applyView } from './view-modes';
import type { ViewModeId } from './view-modes';
import type { LayoutId } from './layouts';

const DEFAULT_MODE: ViewModeId = 'architecture';
const DEFAULT_LAYOUT: LayoutId = 'hierarchical';

export function GraphWorkspace({
  projectId,
  /** The project's newest build, so a graph of an older one can say so. */
  latestRunId,
}: {
  projectId: string;
  latestRunId?: string;
}) {
  const navigate = useNavigate();
  const graph = useProjectGraph(projectId);
  const validation = useGraphValidation(projectId);
  const refresh = useRefreshGraph(projectId);

  /*
   * A graph built from an earlier run is not this project as it stands now,
   * and saying so is the whole difference between a map and a stale map.
   *
   * The test is whether the latest run is *in* the graph, not whether one id
   * matches it. `runId` is null whenever the loaded nodes disagree, which is
   * the ordinary state after an applied edit — the edit resyncs its own
   * slice with its own run id while everything it did not touch keeps the
   * old one — so comparing it against the latest run flagged every edited
   * project as stale. `runIds` holds every run represented, which is the
   * thing the question is actually about.
   */
  const stale =
    latestRunId !== undefined &&
    graph.data !== undefined &&
    graph.data.runIds.length > 0 &&
    !graph.data.runIds.includes(latestRunId);

  // Shareable, back-button-friendly view state.
  const [params, setParams] = useSearchParams();
  const mode = (params.get('view') as ViewModeId | null) ?? DEFAULT_MODE;
  const layout = (params.get('layout') as LayoutId | null) ?? DEFAULT_LAYOUT;
  const search = params.get('q') ?? '';
  const selectedId = params.get('node');

  const [impactOpen, setImpactOpen] = useState(false);
  const [fitSignal, setFitSignal] = useState(0);

  const patch = useCallback(
    (next: Record<string, string | null>) => {
      setParams(
        (current) => {
          const updated = new URLSearchParams(current);
          for (const [key, value] of Object.entries(next)) {
            if (value === null || value === '') updated.delete(key);
            else updated.set(key, value);
          }
          return updated;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const allNodes = useMemo(() => graph.data?.nodes ?? [], [graph.data]);
  const allEdges = useMemo(() => graph.data?.edges ?? [], [graph.data]);

  // The one derivation every part of the screen reads from.
  const visible = useMemo(
    () => applyView(allNodes, allEdges, { mode, search }),
    [allNodes, allEdges, mode, search],
  );

  const selectedNode = useMemo(
    () => allNodes.find((node) => node.id === selectedId) ?? null,
    [allNodes, selectedId],
  );

  const flaggedIds = useMemo(
    () => new Set((validation.data?.issues ?? []).flatMap((issue) => issue.nodeIds)),
    [validation.data],
  );

  /*
   * The canvas emphasises an impact result over a plain selection, and was
   * handed a set that was permanently empty — so that branch could never
   * run, however loudly the panel beside it listed what a change would
   * reach. Both read the same query: React Query serves them from one
   * request rather than asking the server twice for the same traversal.
   */
  const impact = useGraphImpact(projectId, impactOpen ? selectedId : null);

  const impactedIds = useMemo(() => {
    if (impact.data === undefined) return new Set<string>();
    // The origin stays bright. An impact highlight that dims the node you
    // asked about reads as though the selection had been lost.
    return new Set([impact.data.origin.id, ...impact.data.impacted.map((entry) => entry.node.id)]);
  }, [impact.data]);

  const select = useCallback(
    (nodeId: string | null) => {
      patch({ node: nodeId });
      setImpactOpen(false);
    },
    [patch],
  );

  /**
   * Focusing from a list (a relationship, an impact row, a validation
   * issue) may target a node the current filter hides — so widen to
   * Everything rather than selecting something invisible.
   */
  const focusNode = useCallback(
    (nodeId: string) => {
      const isVisible = visible.nodes.some((node) => node.id === nodeId);
      patch({ node: nodeId, ...(isVisible ? {} : { view: 'all', q: null }) });
      setFitSignal((value) => value + 1);
    },
    [patch, visible.nodes],
  );

  if (graph.isPending) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading the engineering graph">
        <Skeleton className="h-9" />
        <Skeleton className="h-[540px]" />
      </div>
    );
  }

  if (graph.isError) {
    return (
      <EmptyState
        icon={<Network className="size-4" />}
        title="The graph couldn't be loaded"
        description={graph.error.message}
        action={
          <Button
            variant="primary"
            onClick={() => {
              void graph.refetch();
            }}
          >
            Try again
          </Button>
        }
      />
    );
  }

  if (graph.data.stats.nodeCount === 0) {
    return (
      <EmptyState
        icon={<Network className="size-4" />}
        title="Engineering graph is not available yet"
        description="The graph is built from a completed run. Run the project pipeline and it appears here, mapping requirements through services and entities to generated files."
        action={
          <Button
            variant="forge"
            icon={<Hammer className="size-3.5" />}
            onClick={() => {
              void navigate(`/projects/${projectId}/build`);
            }}
          >
            Build project
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-fg-subtle">
          Mapped from this project&rsquo;s generated files ·{' '}
          {graph.data.generatedAt === null
            ? 'not analysed yet'
            : `analysed ${formatRelativeTime(graph.data.generatedAt)}`}
          {/* Several runs in one graph is normal, not a fault — it is what an
              applied edit leaves behind — so it is stated here rather than
              warned about. */}
          {graph.data.runIds.length > 1 &&
            ` · spans ${String(graph.data.runIds.length)} builds of this project`}
        </p>
        <Button
          size="sm"
          icon={<RefreshCw className="size-3.5" />}
          loading={refresh.isPending}
          onClick={() => {
            refresh.mutate(undefined, {
              onError: (error) => {
                toast(
                  error instanceof Error ? error.message : 'Could not refresh the graph',
                  'error',
                );
              },
            });
          }}
        >
          Refresh
        </Button>
      </div>

      {stale && (
        <Card className="border-warning/40">
          <div className="flex flex-wrap items-center gap-2 p-3 text-sm">
            <AlertTriangle className="size-4 shrink-0 text-warning" />
            <span className="text-fg-muted">
              This graph does not include the project&rsquo;s latest build. Refresh it to map the
              one that is there now.
            </span>
          </div>
        </Card>
      )}

      <GraphStats stats={graph.data.stats} />

      <GraphToolbar
        search={search}
        onSearch={(value) => {
          patch({ q: value || null });
        }}
        mode={mode}
        onMode={(next) => {
          patch({ view: next === DEFAULT_MODE ? null : next });
        }}
        layout={layout}
        onLayout={(next) => {
          patch({ layout: next === DEFAULT_LAYOUT ? null : next });
        }}
        onReset={() => {
          patch({ view: null, layout: null, q: null, node: null });
          setImpactOpen(false);
          setFitSignal((value) => value + 1);
        }}
        visibleCount={visible.nodes.length}
        totalCount={graph.data.stats.nodeCount}
      />

      <div
        className={cn(
          'grid gap-3',
          selectedNode ? 'lg:grid-cols-[minmax(0,1fr)_320px]' : 'grid-cols-1',
        )}
      >
        <Card className="overflow-hidden">
          {visible.nodes.length === 0 ? (
            <EmptyState
              icon={<Network className="size-4" />}
              title="Nothing matches"
              description="No node in this project matches the current view and search."
              className="border-0 py-20"
            />
          ) : (
            <div className="h-[420px] sm:h-[520px] lg:h-[600px]">
              <GraphCanvas
                nodes={visible.nodes}
                edges={visible.edges}
                layout={layout}
                selectedId={selectedId}
                impactedIds={impactedIds}
                flaggedIds={flaggedIds}
                onSelect={select}
                fitSignal={fitSignal}
              />
            </div>
          )}
        </Card>

        {selectedNode && (
          <Card className="max-h-[600px] overflow-hidden">
            <NodeDetails
              projectId={projectId}
              node={selectedNode}
              nodes={graph.data.nodes}
              impactOpen={impactOpen}
              onToggleImpact={() => {
                setImpactOpen((open) => !open);
              }}
              onFocusNode={focusNode}
              onClose={() => {
                select(null);
              }}
            />
          </Card>
        )}
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-2.5">
          <GraphLegend />
          {visible.hiddenCount > 0 && (
            <p className="text-2xs text-fg-subtle">
              {visible.hiddenCount} node{visible.hiddenCount === 1 ? '' : 's'} hidden by this view
            </p>
          )}
        </CardContent>
      </Card>

      {validation.data && <GraphHealth report={validation.data} onFocusNode={focusNode} />}
    </div>
  );
}
