import { AlertTriangle, Download, Network } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { PageHeader } from '@/shared/components/page-header';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent } from '@/shared/components/ui/card';
import { EmptyState } from '@/shared/components/ui/empty-state';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { downloadText } from '@/shared/lib/download';
import { ApiClientError } from '@/shared/services/api-client';
import { usePipelineStore } from '@/shared/store/pipeline.store';
import { CodeViewer } from './components/code-viewer';
import { OpenApiExplorer } from './components/openapi-explorer';
import { useDesignBundle } from './use-design';

export function ApiContractWorkspace() {
  const navigate = useNavigate();
  const architecture = usePipelineStore((state) => state.architecture);
  const design = useDesignBundle();
  const openapi = design.data?.openapi;

  return (
    <>
      <PageHeader
        variant="section"
        title="API Contract"
        description={
          openapi
            ? `${openapi.info.title} · OpenAPI ${openapi.openapi}`
            : 'The OpenAPI 3.1 contract generated from the architecture plan and database design.'
        }
        actions={
          openapi ? (
            <Button
              variant="primary"
              icon={<Download className="size-3.5" />}
              onClick={() => {
                downloadText('openapi.json', JSON.stringify(openapi, null, 2), 'application/json');
              }}
            >
              Export openapi.json
            </Button>
          ) : undefined
        }
      />

      {!architecture && (
        <EmptyState
          icon={<Network className="size-4" />}
          title="No architecture plan yet"
          description="Plan the architecture first — the API contract is generated alongside the database design."
          action={
            <Button
              variant="forge"
              onClick={() => {
                void navigate('/architecture');
              }}
            >
              Open the architecture planner
            </Button>
          }
        />
      )}

      {architecture && design.isPending && (
        <div className="space-y-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-64" />
        </div>
      )}

      {architecture && design.isError && (
        <Card className="border-danger/40">
          <CardContent className="flex items-start gap-3 py-4">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
            <div>
              <p className="text-sm font-medium text-fg">Contract generation failed</p>
              <p className="mt-1 text-xs text-fg-muted">
                {design.error instanceof ApiClientError
                  ? design.error.message
                  : 'Unexpected error.'}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {openapi && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="ember">OpenAPI {openapi.openapi}</Badge>
            <Badge variant="neutral">{Object.keys(openapi.paths).length} paths</Badge>
            <Badge variant="neutral">
              {Object.keys(openapi.components.schemas).length} schemas
            </Badge>
            <Badge variant="accent">bearer JWT</Badge>
          </div>

          <section className="mt-6">
            <h2 className="mb-3 text-sm font-medium text-fg">Operations</h2>
            <OpenApiExplorer doc={openapi} />
          </section>

          <section className="mt-8">
            <h2 className="mb-3 text-sm font-medium text-fg">Raw specification</h2>
            <CodeViewer
              code={JSON.stringify(openapi, null, 2)}
              filename="openapi.json"
              mime="application/json"
              language="json"
            />
          </section>
        </>
      )}
    </>
  );
}
