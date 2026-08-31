/**
 * Counts, straight from the server's stats block.
 *
 * Deliberately one line rather than a row of tiles: the numbers are
 * context for the canvas below, not the point of the page, and eight cards
 * would push the graph itself under the fold.
 */
import type { EngGraphStats, EngNodeType } from '@/shared/types/api';
import { Card, CardContent } from '@/shared/components/ui/card';

/** The counts worth surfacing, in the order the pipeline produces them. */
const HIGHLIGHT: EngNodeType[] = ['SERVICE', 'API', 'ENTITY', 'COMPONENT', 'FILE', 'TEST'];

export function GraphStats({ stats }: { stats: EngGraphStats }) {
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-x-5 gap-y-2 py-2.5">
        <Stat label="Nodes" value={stats.nodeCount} strong />
        <Stat label="Edges" value={stats.edgeCount} strong />
        <span className="h-4 w-px bg-line" aria-hidden="true" />
        {HIGHLIGHT.filter((type) => stats.nodesByType[type]).map((type) => (
          <Stat key={type} label={type} value={stats.nodesByType[type] ?? 0} />
        ))}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="font-mono text-2xs tracking-widest text-fg-subtle uppercase">{label}</span>
      <span
        className={
          strong
            ? 'text-sm font-semibold text-fg tabular-nums'
            : 'text-xs text-fg-muted tabular-nums'
        }
      >
        {value}
      </span>
    </span>
  );
}
