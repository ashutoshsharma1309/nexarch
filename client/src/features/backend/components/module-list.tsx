import { Layers } from 'lucide-react';

import { Badge } from '@/shared/components/ui/badge';
import { Card, CardContent } from '@/shared/components/ui/card';
import type { GeneratedModuleSummary } from '@/shared/types/api';

export function ModuleList({ modules }: { modules: GeneratedModuleSummary[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {modules.map((mod) => (
        <Card key={mod.name}>
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <div className="flex items-center gap-2">
              <Layers className="size-3.5 text-fg-subtle" />
              <h3 className="text-[0.8125rem] font-medium text-fg">{mod.name}</h3>
            </div>
            <Badge variant={mod.crud ? 'success' : 'neutral'}>
              {mod.crud ? 'CRUD' : 'scaffold'}
            </Badge>
          </div>
          <CardContent className="space-y-1.5 px-4 py-3">
            <p className="flex justify-between text-2xs text-fg-muted">
              <span>Controller</span>
              <code className="text-fg-subtle">{mod.controller}</code>
            </p>
            <p className="flex justify-between text-2xs text-fg-muted">
              <span>Service</span>
              <code className="text-fg-subtle">{mod.service}</code>
            </p>
            {mod.repository && (
              <p className="flex justify-between text-2xs text-fg-muted">
                <span>Repository</span>
                <code className="text-fg-subtle">{mod.repository}</code>
              </p>
            )}
            <p className="flex justify-between text-2xs text-fg-muted">
              <span>Endpoints</span>
              <span className="text-fg-subtle">{mod.endpoints}</span>
            </p>
            <p className="flex justify-between text-2xs text-fg-muted">
              <span>Files</span>
              <span className="text-fg-subtle">{mod.files.length}</span>
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
