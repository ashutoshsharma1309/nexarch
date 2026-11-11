/**
 * Everything known about the selected node.
 *
 * All of it comes from the graph APIs: the neighbourhood endpoint supplies
 * relationships in both directions, the impact endpoint supplies what a
 * change would reach. Nothing is recomputed here — the browser's job is to
 * render the server's answer, not to have its own opinion about the graph.
 *
 * Relationships are grouped by kind rather than listed flat, because "what
 * does this expose" and "what depends on this" are different questions and
 * a single list of twenty arrows answers neither quickly. Each one carries
 * the evidence from its edge, so the reader can see *why* the graph says two
 * things are connected rather than taking the arrow on trust.
 */
import { ArrowUpRight, ExternalLink, Radar, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { useGraphImpact, useGraphNode } from '@/shared/hooks/use-graph';
import { cn } from '@/shared/lib/cn';
import type { EngGraphEdge, EngGraphNode, GraphImpactAnalysis } from '@/shared/types/api';
import { artifactTarget } from './artifact-links';
import { edgeEvidence } from './edge-evidence';
import { FAMILY_DOT, FAMILY_OF } from './node-style';
import { TraceTo } from './trace-to';

/** Metadata values are arbitrary JSON; render them without trusting `String()`. */
function formatValue(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="mb-1.5 font-mono text-2xs tracking-widest text-fg-subtle uppercase">
        {title}
      </h4>
      {children}
    </section>
  );
}

/**
 * One relationship, with whatever the edge records as evidence for it.
 *
 * The evidence line is always rendered, including when there is none to
 * render: an edge the builder annotated with nothing is one that nothing
 * explains, and a row showing only a verb read as a certainty the graph
 * never claimed.
 */
function Relationship({
  entry,
  direction,
  onFocusNode,
}: {
  entry: { edge: EngGraphEdge; node: EngGraphNode };
  direction: 'outgoing' | 'incoming';
  onFocusNode: (nodeId: string) => void;
}) {
  const evidence = edgeEvidence(entry.edge.metadata);

  return (
    <li>
      <button
        type="button"
        onClick={() => {
          onFocusNode(entry.node.id);
        }}
        className="w-full rounded-sm px-0.5 py-0.5 text-left transition-[filter] hover:brightness-125 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
      >
        <span className="flex items-center gap-1.5 font-mono text-2xs text-fg-muted">
          {direction === 'outgoing' ? (
            <>
              <span className="shrink-0 text-ember">{entry.edge.relationship}</span>
              <span className="min-w-0 truncate">{entry.node.name}</span>
            </>
          ) : (
            <>
              <span className="min-w-0 truncate">{entry.node.name}</span>
              <span className="shrink-0 text-accent">{entry.edge.relationship}</span>
            </>
          )}
          <ArrowUpRight className="size-2.5 shrink-0 opacity-50" />
        </span>
        <span className="mt-0.5 block truncate text-2xs text-fg-subtle">
          {evidence ?? 'no evidence recorded'}
        </span>
      </button>
    </li>
  );
}

/**
 * What a change here would reach.
 *
 * Direct and indirect dependants are kept apart because they are different
 * news, and the server now says which is which: a direct dependant is one
 * the graph joins to this node by a single stated edge, and anything further
 * out was reached through a chain, which is an inference. The flat list left
 * the reader to make that distinction from a depth number in their head.
 */
function ImpactList({
  analysis,
  onFocusNode,
}: {
  analysis: GraphImpactAnalysis;
  onFocusNode: (nodeId: string) => void;
}) {
  const direct = analysis.impacted.filter((entry) => entry.direct);
  const indirect = analysis.impacted.filter((entry) => !entry.direct);

  return (
    <>
      <div className="mb-2 flex flex-wrap gap-1">
        {Object.entries(analysis.summary).map(([type, count]) => (
          <Badge key={type} variant="warning">
            {count} {type}
          </Badge>
        ))}
      </div>

      {/* A capped traversal presented as a finished one is the one way this
          panel could understate a blast radius. */}
      {analysis.truncated && (
        <p className="mb-2 text-2xs text-warning">
          This is as far as the traversal went — more of the project is affected than is listed
          here.
        </p>
      )}

      <div className="space-y-2.5">
        {direct.length > 0 && (
          <div>
            <p className="mb-1 text-2xs text-fg-subtle">Directly depends on this</p>
            <ul className="space-y-0.5">
              {direct.map((entry) => (
                <li key={entry.node.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onFocusNode(entry.node.id);
                    }}
                    className="w-full rounded-sm text-left text-2xs text-fg-muted transition-colors hover:text-fg focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                  >
                    {entry.reason}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {indirect.length > 0 && (
          <div>
            <p className="mb-1 text-2xs text-fg-subtle">Reached through something else</p>
            <ul className="space-y-0.5">
              {indirect.map((entry) => (
                <li key={entry.node.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onFocusNode(entry.node.id);
                    }}
                    className="flex w-full items-start gap-1.5 rounded-sm text-left text-2xs text-fg-muted transition-colors hover:text-fg focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                  >
                    <span className="shrink-0 font-mono text-fg-subtle">d{entry.depth}</span>
                    <span className="min-w-0">{entry.reason}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </>
  );
}

export interface NodeDetailsProps {
  projectId: string;
  node: EngGraphNode;
  /** Every node in the project — the candidates a trace can end at. */
  nodes: EngGraphNode[];
  impactOpen: boolean;
  onToggleImpact: () => void;
  onFocusNode: (nodeId: string) => void;
  onClose: () => void;
}

export function NodeDetails({
  projectId,
  node,
  nodes,
  impactOpen,
  onToggleImpact,
  onFocusNode,
  onClose,
}: NodeDetailsProps) {
  const navigate = useNavigate();
  const detail = useGraphNode(projectId, node.id);
  // Only fetched once the user asks — impact is a traversal, not free.
  const impact = useGraphImpact(projectId, impactOpen ? node.id : null);
  const source = artifactTarget(projectId, node.sourceArtifactId);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-start justify-between gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-mono text-2xs tracking-widest text-fg-subtle uppercase">
            <span className={cn('size-1.5 rounded-full', FAMILY_DOT[FAMILY_OF[node.type]])} />
            {node.type}
          </p>
          <h3 className="mt-1 text-sm font-medium break-words text-fg">{node.name}</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="shrink-0 rounded-sm p-1 text-fg-subtle transition-colors hover:text-fg focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
        >
          <X className="size-3.5" />
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
        {node.description && (
          <p className="text-xs leading-relaxed text-fg-muted">{node.description}</p>
        )}

        <div className="flex flex-wrap gap-1.5">
          <Badge variant="neutral">id: {node.canonicalName}</Badge>
          {node.sourceArtifactId && <Badge variant="ember">{node.sourceArtifactId}</Badge>}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={impactOpen ? 'primary' : 'secondary'}
            icon={<Radar className="size-3.5" />}
            onClick={onToggleImpact}
          >
            {impactOpen ? 'Hide impact' : 'View impact'}
          </Button>
          {source ? (
            <Button
              size="sm"
              icon={<ExternalLink className="size-3.5" />}
              onClick={() => {
                void navigate(source.href);
              }}
            >
              View in {source.label}
            </Button>
          ) : (
            /* Two different claims, and this said the first when the truth
               was the second: a product FEATURE stamped `product-spec` does
               have a source artifact, the workspace just has no page for
               it. */
            <span className="self-center text-2xs text-fg-subtle">
              {node.sourceArtifactId === null
                ? 'No source artifact for this node'
                : `Its source artifact (${node.sourceArtifactId}) has no page in this workspace`}
            </span>
          )}
        </div>

        {Object.keys(node.metadata).length > 0 && (
          <Section title="Metadata">
            <dl className="space-y-0.5">
              {Object.entries(node.metadata).map(([key, value]) => (
                <div key={key} className="flex gap-2 text-2xs">
                  <dt className="shrink-0 font-mono text-fg-subtle">{key}</dt>
                  <dd className="min-w-0 truncate text-fg-muted">{formatValue(value)}</dd>
                </div>
              ))}
            </dl>
          </Section>
        )}

        <Section title="Trace to…">
          <TraceTo projectId={projectId} origin={node} nodes={nodes} onFocusNode={onFocusNode} />
        </Section>

        <Section title="Relationships">
          {detail.isPending ? (
            <Skeleton className="h-20" />
          ) : detail.isError ? (
            <p className="text-xs text-danger">Relationships could not be loaded.</p>
          ) : detail.data.outgoing.length + detail.data.incoming.length === 0 ? (
            <p className="text-xs text-fg-subtle">This node has no relationships.</p>
          ) : (
            <div className="space-y-2.5">
              {detail.data.outgoing.length > 0 && (
                <div>
                  <p className="mb-1 text-2xs text-fg-subtle">Depends on / contains</p>
                  <ul className="space-y-1">
                    {detail.data.outgoing.map((entry) => (
                      <Relationship
                        key={entry.edge.id}
                        entry={entry}
                        direction="outgoing"
                        onFocusNode={onFocusNode}
                      />
                    ))}
                  </ul>
                </div>
              )}
              {detail.data.incoming.length > 0 && (
                <div>
                  <p className="mb-1 text-2xs text-fg-subtle">Depended on by</p>
                  <ul className="space-y-1">
                    {detail.data.incoming.map((entry) => (
                      <Relationship
                        key={entry.edge.id}
                        entry={entry}
                        direction="incoming"
                        onFocusNode={onFocusNode}
                      />
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </Section>

        {impactOpen && (
          <Section title="Impact if changed">
            {impact.isPending ? (
              <Skeleton className="h-16" />
            ) : impact.isError ? (
              <p className="text-xs text-danger">Impact analysis could not be loaded.</p>
            ) : impact.data.impacted.length === 0 ? (
              <p className="text-xs text-fg-subtle">Nothing else depends on this node.</p>
            ) : (
              <ImpactList analysis={impact.data} onFocusNode={onFocusNode} />
            )}
          </Section>
        )}
      </div>
    </div>
  );
}
