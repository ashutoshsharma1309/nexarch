import { Lock, Zap } from 'lucide-react';

import { Badge } from '@/shared/components/ui/badge';
import type { FrontendRouteSummary } from '@/shared/types/api';

export function RouteList({ routes }: { routes: FrontendRouteSummary[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full min-w-[32rem] text-left text-xs">
        <thead>
          <tr className="border-b border-line font-mono text-2xs tracking-wide text-fg-subtle uppercase">
            <th className="px-4 py-2.5 font-medium">Path</th>
            <th className="px-4 py-2.5 font-medium">Page</th>
            <th className="px-4 py-2.5 font-medium">Loading</th>
            <th className="px-4 py-2.5 font-medium">Access</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {routes.map((route) => (
            <tr key={route.path} className="hover:bg-raised/40">
              <td className="px-4 py-2">
                <code className="font-mono text-xs text-fg">{route.path}</code>
              </td>
              <td className="px-4 py-2 text-fg-muted">{route.page}</td>
              <td className="px-4 py-2">
                {route.lazy && (
                  <Badge variant="accent" title="Code-split via React.lazy">
                    <Zap className="size-2.5" /> lazy
                  </Badge>
                )}
              </td>
              <td className="px-4 py-2">
                {route.protected ? (
                  <span className="flex items-center gap-1 text-2xs text-fg-muted">
                    <Lock className="size-3" /> protected
                  </span>
                ) : (
                  <span className="text-2xs text-fg-subtle">public</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
