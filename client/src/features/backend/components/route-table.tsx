import { Lock } from 'lucide-react';

import { Badge } from '@/shared/components/ui/badge';
import { cn } from '@/shared/lib/cn';
import type { GeneratedRoute } from '@/shared/types/api';

const methodStyles: Record<string, string> = {
  GET: 'text-accent border-accent/30',
  POST: 'text-success border-success/30',
  PUT: 'text-warning border-warning/30',
  PATCH: 'text-warning border-warning/30',
  DELETE: 'text-danger border-danger/30',
};

export function RouteTable({ routes }: { routes: GeneratedRoute[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full min-w-[36rem] text-left text-xs">
        <thead>
          <tr className="border-b border-line font-mono text-2xs tracking-wide text-fg-subtle uppercase">
            <th className="px-4 py-2.5 font-medium">Method</th>
            <th className="px-4 py-2.5 font-medium">Path</th>
            <th className="px-4 py-2.5 font-medium">Handler</th>
            <th className="px-4 py-2.5 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {routes.map((route) => (
            <tr key={`${route.method} ${route.path}`} className="hover:bg-raised/40">
              <td className="px-4 py-2">
                <span
                  className={cn(
                    'inline-block w-14 rounded-sm border text-center font-mono text-2xs font-medium',
                    methodStyles[route.method],
                  )}
                >
                  {route.method}
                </span>
              </td>
              <td className="px-4 py-2">
                <code className="font-mono text-xs text-fg">{route.path}</code>
              </td>
              <td className="px-4 py-2">
                <span className="flex items-center gap-1.5 font-mono text-2xs text-fg-muted">
                  {route.handler}
                  {route.auth && (
                    <Lock className="size-3 shrink-0 text-fg-subtle" aria-label="Requires auth" />
                  )}
                </span>
              </td>
              <td className="px-4 py-2">
                <Badge variant={route.implemented ? 'success' : 'warning'}>
                  {route.implemented ? 'implemented' : 'scaffold'}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
