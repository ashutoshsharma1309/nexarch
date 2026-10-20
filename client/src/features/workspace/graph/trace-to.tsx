/**
 * "Trace to…" — follow one node to another through the graph's real edges.
 *
 * This is the question the Knowledge Graph existed to answer and could not:
 * *this requirement — where does it actually end up in the code?* The
 * traversal has been on the server all along (`/graph/nodes/:id/path?to=`),
 * walking stored edges; nothing here computes a route, and nothing here
 * invents a file. A hop is rendered from the node object the server returned,
 * so a path that appears is one the project genuinely has.
 *
 * The two answers that matter are different and are shown differently: a
 * chain, or "there is no path between these" — which is a real finding about
 * a project, not an empty state to hide.
 */
import { useMemo, useState } from 'react';
import { ArrowDown, Route, Search, X } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { useGraphPath } from '@/shared/hooks/use-graph';
import { cn } from '@/shared/lib/cn';
import type { EngGraphNode, GraphPath } from '@/shared/types/api';
import { FAMILY_DOT, FAMILY_OF } from './node-style';

/** Candidates offered first: where a requirement usually lands. */
const PREFERRED_ORDER = ['FILE', 'TEST', 'COMPONENT', 'API', 'ENTITY', 'MODULE', 'SERVICE'];

const MAX_SUGGESTIONS = 8;

function rank(node: EngGraphNode): number {
  const index = PREFERRED_ORDER.indexOf(node.type);
  return index === -1 ? PREFERRED_ORDER.length : index;
}

/** The path a file node carries, when it has one — never assembled here. */
function pathOf(node: EngGraphNode): string | null {
  const value = node.metadata.path;
  return typeof value === 'string' && value !== '' ? value : null;
}

export function TraceTo({
  projectId,
  origin,
  nodes,
  onFocusNode,
}: {
  projectId: string;
  origin: EngGraphNode;
  /** Every node in the project — the only things that can be a destination. */
  nodes: EngGraphNode[];
  onFocusNode: (nodeId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [target, setTarget] = useState<EngGraphNode | null>(null);
  const path = useGraphPath(projectId, origin.id, target?.id ?? null);

  const suggestions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === '') return [];
    return nodes
      .filter((node) => node.id !== origin.id)
      .filter(
        (node) =>
          node.name.toLowerCase().includes(needle) ||
          (pathOf(node)?.toLowerCase().includes(needle) ?? false),
      )
      .sort((a, b) => rank(a) - rank(b) || a.name.length - b.name.length)
      .slice(0, MAX_SUGGESTIONS);
  }, [nodes, origin.id, query]);

  return (
    <div className="space-y-2">
      {target === null ? (
        <>
          <label className="relative block">
            <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-subtle" />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              placeholder="Find a file, component or entity…"
              className="w-full rounded-md border border-line bg-inset py-1.5 pr-2 pl-8 text-xs outline-none placeholder:text-fg-subtle focus-visible:border-accent"
            />
          </label>

          {query.trim() !== '' && suggestions.length === 0 && (
            <p className="text-2xs text-fg-subtle">
              Nothing in this project&rsquo;s graph matches &ldquo;{query.trim()}&rdquo;.
            </p>
          )}

          <ul className="space-y-0.5">
            {suggestions.map((node) => (
              <li key={node.id}>
                <button
                  type="button"
                  onClick={() => {
                    setTarget(node);
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors hover:bg-inset"
                >
                  <span
                    className={cn(
                      'size-1.5 shrink-0 rounded-full',
                      FAMILY_DOT[FAMILY_OF[node.type]],
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">{node.name}</span>
                  <span className="shrink-0 font-mono text-2xs text-fg-subtle">{node.type}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-fg-subtle">to</span>
            <span className="min-w-0 flex-1 truncate font-medium">{target.name}</span>
            <Button
              size="sm"
              variant="ghost"
              icon={<X className="size-3.5" />}
              onClick={() => {
                setTarget(null);
                setQuery('');
              }}
            >
              Change
            </Button>
          </div>

          {path.isPending ? (
            <Skeleton className="h-24" />
          ) : path.isError ? (
            <p className="text-xs text-danger">
              The path could not be traced: {path.error.message}
            </p>
          ) : path.data === null ? (
            <p className="text-xs text-fg-muted">
              The graph holds no path from <span className="font-medium">{origin.name}</span> to{' '}
              <span className="font-medium">{target.name}</span>. They are both in this project, but
              nothing connects them — no import, no containment, nothing generated one from the
              other.
            </p>
          ) : (
            <Chain path={path.data} onFocusNode={onFocusNode} />
          )}
        </>
      )}
    </div>
  );
}

function Chain({ path, onFocusNode }: { path: GraphPath; onFocusNode: (nodeId: string) => void }) {
  return (
    <ol className="space-y-0">
      {path.nodes.map((node, index) => {
        // The relationship that led here is the one before this node.
        const via = index === 0 ? null : path.hops[index - 1];
        return (
          <li key={node.id}>
            {via !== null && via !== undefined && (
              <div className="flex items-center gap-1.5 py-0.5 pl-2 text-2xs text-fg-subtle">
                <ArrowDown className="size-3" />
                <span className="font-mono">{via.relationship}</span>
                {/* An edge walked against its direction is still a real edge,
                    and the reader is told which way it actually points. */}
                {via.direction === 'backward' && (
                  <span title="this edge points the other way">(reversed)</span>
                )}
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                onFocusNode(node.id);
              }}
              className="flex w-full items-center gap-2 rounded-md border border-line bg-surface px-2 py-1.5 text-left text-xs transition-colors hover:border-line-strong"
            >
              <span
                className={cn('size-1.5 shrink-0 rounded-full', FAMILY_DOT[FAMILY_OF[node.type]])}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{node.name}</span>
                {pathOf(node) !== null && (
                  <span className="block truncate font-mono text-2xs text-fg-subtle">
                    {pathOf(node)}
                  </span>
                )}
              </span>
              <span className="shrink-0 font-mono text-2xs text-fg-subtle">{node.type}</span>
            </button>
          </li>
        );
      })}
      <li className="flex items-center gap-1.5 pt-2 text-2xs text-fg-subtle">
        <Route className="size-3" />
        {path.relationships.length === 0
          ? 'The origin is the destination.'
          : `${String(path.relationships.length)} ${path.relationships.length === 1 ? 'hop' : 'hops'}, following edges the graph holds.`}
      </li>
    </ol>
  );
}
