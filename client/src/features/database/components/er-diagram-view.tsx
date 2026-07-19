import { KeyRound, Link2 } from 'lucide-react';

import { Card } from '@/shared/components/ui/card';
import type { ErDiagram } from '@/shared/types/api';

/**
 * ER diagram: entity cards showing each table's columns, with an edge list
 * describing the relationships and their cardinality. A card-and-list
 * rendering reads more clearly on a wide schema than a force-directed graph,
 * and the raw nodes/edges remain in the exported er-diagram.json for tools
 * that lay out geometry.
 */
export function ErDiagramView({ diagram }: { diagram: ErDiagram }) {
  const labelOf = (id: string): string => diagram.nodes.find((n) => n.id === id)?.label ?? id;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {diagram.nodes.map((node) => (
          <Card key={node.id} className="overflow-hidden">
            <div className="border-b border-line bg-raised/40 px-3 py-2">
              <h3 className="font-mono text-xs font-semibold text-fg">{node.label}</h3>
            </div>
            <ul className="divide-y divide-line/60">
              {node.columns.map((column) => (
                <li key={column.name} className="flex items-center gap-2 px-3 py-1.5">
                  {column.primaryKey ? (
                    <KeyRound className="size-3 shrink-0 text-warning" aria-label="PK" />
                  ) : column.foreignKey ? (
                    <Link2 className="size-3 shrink-0 text-accent" aria-label="FK" />
                  ) : (
                    <span className="size-3 shrink-0" />
                  )}
                  <span className="flex-1 font-mono text-2xs text-fg-muted">{column.name}</span>
                  <span className="font-mono text-2xs text-fg-subtle">{column.type}</span>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>

      <div>
        <p className="mb-2 font-mono text-2xs tracking-widest text-fg-subtle uppercase">
          Relationships
        </p>
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {diagram.edges.map((edge) => (
            <li key={edge.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-xs">
              <span className="font-medium text-fg">{labelOf(edge.from)}</span>
              <span className="font-mono text-2xs text-ember">{edge.label}</span>
              <span className="font-medium text-fg">{labelOf(edge.to)}</span>
              <span className="font-mono text-2xs text-fg-subtle">via {edge.foreignKey}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
