import { LayoutDashboard } from 'lucide-react';

import { Badge } from '@/shared/components/ui/badge';
import { Card, CardContent } from '@/shared/components/ui/card';
import type { FrontendPageSummary } from '@/shared/types/api';

export function PageList({ pages }: { pages: FrontendPageSummary[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {pages.map((page) => (
        <Card key={page.name}>
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <div className="flex items-center gap-2">
              <LayoutDashboard className="size-3.5 text-fg-subtle" />
              <h3 className="text-[0.8125rem] font-medium text-fg">{page.name}</h3>
            </div>
            <Badge variant={page.implemented ? 'success' : 'neutral'}>
              {page.implemented ? 'live' : 'pending'}
            </Badge>
          </div>
          <CardContent className="space-y-1.5 px-4 py-3">
            <p className="flex justify-between text-2xs text-fg-muted">
              <span>Route</span>
              <code className="text-fg-subtle">{page.route}</code>
            </p>
            <p className="flex justify-between text-2xs text-fg-muted">
              <span>Kind</span>
              <span className="text-fg-subtle">{page.kind}</span>
            </p>
            {page.entity && (
              <p className="flex justify-between text-2xs text-fg-muted">
                <span>Entity</span>
                <span className="text-fg-subtle">{page.entity}</span>
              </p>
            )}
            <p className="flex justify-between text-2xs text-fg-muted">
              <span>Files</span>
              <span className="text-fg-subtle">{page.files.length}</span>
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
