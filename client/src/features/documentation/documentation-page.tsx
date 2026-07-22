import { useState } from 'react';
import { Download, FileText } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { PageHeader } from '@/shared/components/page-header';
import { Button } from '@/shared/components/ui/button';
import { EmptyState } from '@/shared/components/ui/empty-state';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { useCurrentArtifacts } from '@/shared/hooks/use-current-artifacts';
import { useDocumentTitle } from '@/shared/hooks/use-document-title';
import { useGenerateDocumentation } from '@/shared/hooks/use-workspace';
import { cn } from '@/shared/lib/cn';
import { downloadText } from '@/shared/lib/download';
import { toast } from '@/shared/store/toast.store';
import type { DocumentationType } from '@/shared/types/api';

const DOC_TYPES: { type: DocumentationType; label: string }[] = [
  { type: 'readme', label: 'README' },
  { type: 'api', label: 'API' },
  { type: 'architecture', label: 'Architecture' },
  { type: 'database', label: 'Database' },
  { type: 'security', label: 'Security' },
  { type: 'deployment-guide', label: 'Deployment Guide' },
  { type: 'developer-guide', label: 'Developer Guide' },
];

export function DocumentationPage() {
  useDocumentTitle('Documentation');
  const navigate = useNavigate();
  const { artifacts } = useCurrentArtifacts();
  const [active, setActive] = useState<DocumentationType>('readme');
  const generate = useGenerateDocumentation();

  const load = (type: DocumentationType): void => {
    if (!artifacts) return;
    setActive(type);
    generate.mutate(
      { type, artifacts },
      {
        onError: () => {
          toast('Could not generate documentation', 'error');
        },
      },
    );
  };

  return (
    <>
      <PageHeader
        eyebrow="console/documentation"
        title="Documentation"
        description="Generated from the current pipeline — README, API, architecture, database, security, deployment, and developer guides."
      />

      {!artifacts ? (
        <EmptyState
          icon={<FileText className="size-4" />}
          title="Nothing to document yet"
          description="Run the forge first — documentation is generated from the live pipeline."
          action={
            <Button
              variant="forge"
              onClick={() => {
                void navigate('/forge');
              }}
            >
              Open the forge
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[200px_1fr]">
          <nav className="flex gap-1.5 overflow-x-auto lg:flex-col lg:overflow-visible">
            {DOC_TYPES.map((doc) => (
              <button
                key={doc.type}
                type="button"
                onClick={() => {
                  load(doc.type);
                }}
                className={cn(
                  'shrink-0 rounded-md px-3 py-1.5 text-left text-xs whitespace-nowrap transition-colors duration-100',
                  active === doc.type && generate.data?.type === doc.type
                    ? 'bg-raised font-medium text-fg'
                    : 'text-fg-muted hover:bg-raised/60 hover:text-fg',
                )}
              >
                {doc.label}
              </button>
            ))}
          </nav>

          <div className="min-w-0 rounded-lg border border-line bg-surface">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <p className="font-mono text-2xs text-fg-subtle">
                {generate.data?.filename ?? 'Select a document'}
              </p>
              <Button
                size="sm"
                variant="secondary"
                icon={<Download className="size-3.5" />}
                disabled={!generate.data}
                onClick={() => {
                  if (generate.data) {
                    downloadText(generate.data.filename, generate.data.markdown, 'text/markdown');
                  }
                }}
              >
                Download
              </Button>
            </div>
            <div className="max-h-[32rem] overflow-y-auto p-4">
              {generate.isPending ? (
                <div className="space-y-2">
                  {Array.from({ length: 8 }, (_, i) => (
                    <Skeleton key={i} className="h-4 w-full" />
                  ))}
                </div>
              ) : generate.data ? (
                <pre className="font-mono text-xs leading-relaxed whitespace-pre-wrap text-fg-muted">
                  {generate.data.markdown}
                </pre>
              ) : (
                <p className="text-xs text-fg-subtle">
                  Choose a document from the left to generate it.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
