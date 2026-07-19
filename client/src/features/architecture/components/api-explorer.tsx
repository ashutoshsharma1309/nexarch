import { Lock } from 'lucide-react';

import { Card, CardContent } from '@/shared/components/ui/card';
import { cn } from '@/shared/lib/cn';
import type { ApiModulePlan, HttpMethod } from '@/shared/types/api';

const methodStyles: Record<HttpMethod, string> = {
  GET: 'text-accent border-accent/30',
  POST: 'text-success border-success/30',
  PUT: 'text-warning border-warning/30',
  PATCH: 'text-warning border-warning/30',
  DELETE: 'text-danger border-danger/30',
};

export function ApiExplorer({ modules }: { modules: ApiModulePlan[] }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {modules.map((module) => (
        <Card key={module.module}>
          <div className="flex items-baseline justify-between border-b border-line px-4 py-2.5">
            <h3 className="text-[0.8125rem] font-medium text-fg">{module.module}</h3>
            <span className="font-mono text-2xs text-fg-subtle">{module.basePath}</span>
          </div>
          <CardContent className="px-2 py-1.5">
            <ul>
              {module.endpoints.map((endpoint) => (
                <li
                  key={`${endpoint.method} ${endpoint.path}`}
                  className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-raised/60"
                  title={endpoint.description}
                >
                  <span
                    className={cn(
                      'w-14 shrink-0 rounded-sm border text-center font-mono text-2xs font-medium',
                      methodStyles[endpoint.method],
                    )}
                  >
                    {endpoint.method}
                  </span>
                  <code className="min-w-0 truncate font-mono text-xs text-fg">
                    {endpoint.path}
                  </code>
                  {endpoint.auth && (
                    <Lock
                      className="ml-auto size-3 shrink-0 text-fg-subtle"
                      aria-label={
                        endpoint.roles
                          ? `Restricted: ${endpoint.roles.join(', ')}`
                          : 'Authenticated'
                      }
                    />
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
