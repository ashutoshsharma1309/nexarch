import { Download, GitBranch, PackageOpen } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { PageHeader } from '@/shared/components/page-header';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { EmptyState } from '@/shared/components/ui/empty-state';
import { useCurrentArtifacts } from '@/shared/hooks/use-current-artifacts';
import { useDocumentTitle } from '@/shared/hooks/use-document-title';
import { useRunExport } from '@/shared/hooks/use-workspace';
import { downloadText } from '@/shared/lib/download';
import { slugify } from '@/shared/lib/slugify';
import { downloadZip } from '@/shared/lib/zip';
import { useSettingsStore } from '@/features/settings/settings-store';
import { toast } from '@/shared/store/toast.store';
import type { ExportFormat, ProjectArtifacts } from '@/shared/types/api';

interface ExportOption {
  format: ExportFormat;
  label: string;
  description: string;
  available: (artifacts: ProjectArtifacts) => boolean;
  unavailableHint: string;
}

const EXPORT_OPTIONS: ExportOption[] = [
  {
    format: 'zip-project',
    label: 'Full project ZIP',
    description: 'Every generated backend and frontend file, bundled for download.',
    available: (a) => Boolean(a.backend && a.frontend),
    unavailableHint: 'Generate the backend and frontend first',
  },
  {
    format: 'docker-package',
    label: 'Docker package',
    description: 'docker-compose.yml, an env template, and a run guide.',
    available: () => true,
    unavailableHint: '',
  },
  {
    format: 'readme',
    label: 'README.md',
    description: 'Project overview, tech stack, and getting-started steps.',
    available: () => true,
    unavailableHint: '',
  },
  {
    format: 'openapi',
    label: 'OpenAPI contract',
    description: 'openapi.json — the full 3.1 API contract.',
    available: (a) => Boolean(a.openapi),
    unavailableHint: 'Design the database first',
  },
  {
    format: 'postman-collection',
    label: 'Postman collection',
    description: 'Every endpoint, converted to a Postman v2.1 collection.',
    available: (a) => Boolean(a.openapi),
    unavailableHint: 'Design the database first',
  },
  {
    format: 'prisma-schema',
    label: 'Prisma schema',
    description: 'schema.prisma — models, enums, and relations.',
    available: (a) => Boolean(a.prismaSchema),
    unavailableHint: 'Design the database first',
  },
  {
    format: 'sql-schema',
    label: 'SQL schema',
    description: 'schema.sql — raw DDL for the target engine.',
    available: (a) => Boolean(a.sqlSchema),
    unavailableHint: 'Design the database first',
  },
  {
    format: 'architecture-report',
    label: 'Architecture report',
    description: 'Modules, services, and folder structure as Markdown.',
    available: (a) => Boolean(a.architecture),
    unavailableHint: 'Plan the architecture first',
  },
  {
    format: 'dependency-graph',
    label: 'Dependency graph JSON',
    description: 'The full node/edge graph and quality report.',
    available: (a) => Boolean(a.dependencyGraph),
    unavailableHint: 'Build the dependency graph first',
  },
  {
    format: 'security-report',
    label: 'Security report',
    description: 'Score, OWASP compliance, and findings as Markdown.',
    available: (a) => Boolean(a.security),
    unavailableHint: 'Run the security review first',
  },
  {
    format: 'project-manifest',
    label: 'Project manifest',
    description: 'project-manifest.json — a machine-readable pipeline snapshot.',
    available: () => true,
    unavailableHint: '',
  },
];

export function ExportsPage() {
  useDocumentTitle('Exports');
  const navigate = useNavigate();
  const { artifacts } = useCurrentArtifacts();
  const runExport = useRunExport();
  const defaultExportFormat = useSettingsStore((state) => state.defaultExportFormat);

  const handleExport = (format: ExportFormat): void => {
    if (!artifacts) return;
    runExport.mutate(
      { format, artifacts },
      {
        onSuccess: (result) => {
          const slug = slugify(artifacts.projectName, 'project');
          if (result.kind === 'file') {
            downloadText(result.filename, result.content, result.mimeType);
          } else {
            downloadZip(`${slug}-${format}.zip`, result.files);
          }
          toast('Export ready — check your downloads', 'success');
        },
        onError: () => {
          toast('Export failed', 'error');
        },
      },
    );
  };

  return (
    <>
      <PageHeader
        eyebrow="console/exports"
        title="Export Center"
        description="Download the current project's generated artifacts in the format you need."
      />

      {!artifacts ? (
        <EmptyState
          icon={<PackageOpen className="size-4" />}
          title="Nothing to export yet"
          description="Run the forge first — exports are built from the live pipeline."
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
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {EXPORT_OPTIONS.map((option) => {
            const available = option.available(artifacts);
            const pending = runExport.isPending && runExport.variables.format === option.format;
            return (
              <Card
                key={option.format}
                className={option.format === defaultExportFormat ? 'border-accent' : undefined}
              >
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <CardTitle>{option.label}</CardTitle>
                    {option.format === defaultExportFormat && (
                      <Badge variant="accent">Default</Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <p className="text-xs text-fg-muted">{option.description}</p>
                  <Button
                    size="sm"
                    icon={<Download className="size-3.5" />}
                    disabled={!available}
                    loading={pending}
                    onClick={() => {
                      handleExport(option.format);
                    }}
                  >
                    {available ? 'Export' : option.unavailableHint}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <div className="mt-8 flex items-center justify-between gap-3 rounded-lg border border-line bg-surface px-5 py-4">
        <p className="text-xs text-fg-muted">
          Exports are built from whatever the pipeline currently has cached — the same source of
          truth every Explorer page reads from.
        </p>
        <Button
          variant="secondary"
          icon={<GitBranch className="size-3.5" />}
          onClick={() => {
            void navigate('/dependency-graph');
          }}
        >
          Open dependency graph
        </Button>
      </div>
    </>
  );
}
