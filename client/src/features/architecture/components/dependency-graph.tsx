import { Card, CardContent } from '@/shared/components/ui/card';
import { Badge } from '@/shared/components/ui/badge';
import type { ArchitecturePlan } from '@/shared/types/api';

/**
 * Module dependency view: one card per module listing what it depends on.
 * (The raw graph — nodes/edges with reasons — ships in the exported JSON
 * for tooling; this rendering optimizes for reading, not for layout math.)
 */
export function DependencyGraph({ graph }: { graph: ArchitecturePlan['dependencyGraph'] }) {
  const labelOf = (id: string): string => graph.nodes.find((node) => node.id === id)?.label ?? id;

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {graph.nodes.map((node) => {
        const dependsOn = graph.edges.filter((edge) => edge.from === node.id);
        const dependents = graph.edges.filter((edge) => edge.to === node.id).length;
        return (
          <Card key={node.id}>
            <CardContent className="px-4 py-3">
              <div className="flex items-center justify-between">
                <h3 className="text-[0.8125rem] font-medium text-fg">{node.label}</h3>
                {dependents > 0 && (
                  <span className="font-mono text-2xs text-fg-subtle">←{dependents}</span>
                )}
              </div>
              {dependsOn.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {dependsOn.map((edge) => (
                    <Badge key={edge.to} variant="neutral" title={edge.reason}>
                      {labelOf(edge.to)}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-2xs text-fg-subtle">no dependencies — build first</p>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
