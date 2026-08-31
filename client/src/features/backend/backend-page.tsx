import { AlertTriangle, FileArchive, Monitor, Search, Server } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { CodeViewer } from '@/features/database/components/code-viewer';
import { PageHeader } from '@/shared/components/page-header';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent } from '@/shared/components/ui/card';
import { EmptyState } from '@/shared/components/ui/empty-state';
import { Input } from '@/shared/components/ui/input';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { cn } from '@/shared/lib/cn';
import { slugify } from '@/shared/lib/slugify';
import { downloadZip } from '@/shared/lib/zip';
import { ApiClientError } from '@/shared/services/api-client';
import { usePipelineStore } from '@/shared/store/pipeline.store';
import type { FileLanguage, GeneratedProject } from '@/shared/types/api';
import { FileTree } from './components/file-tree';
import { ModuleList } from './components/module-list';
import { RouteTable } from './components/route-table';
import { useGeneratedBackend } from './use-generated-backend';

const LANGUAGE_MIME: Record<FileLanguage, string> = {
  typescript: 'text/typescript',
  json: 'application/json',
  markdown: 'text/markdown',
  prisma: 'text/plain',
  env: 'text/plain',
  ignore: 'text/plain',
  javascript: 'text/javascript',
  dockerfile: 'text/plain',
  html: 'text/html',
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-sm font-medium text-fg">{title}</h2>
      {children}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="py-3">
        <p className="font-mono text-2xs tracking-widest text-fg-subtle uppercase">{label}</p>
        <p className="mt-1 text-xl font-semibold text-fg tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}

function FileExplorer({ project }: { project: GeneratedProject }) {
  const [query, setQuery] = useState('');
  const [selectedPath, setSelectedPath] = useState<string | null>('package.json');

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return project.files.filter((f) => f.path.toLowerCase().includes(q)).slice(0, 50);
  }, [project.files, query]);

  const selected = project.files.find((f) => f.path === selectedPath);

  return (
    <div className="grid gap-4 md:grid-cols-[20rem_1fr]">
      <div>
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-subtle" />
          <Input
            type="search"
            placeholder="Search files"
            aria-label="Search files"
            className="pl-8"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
        </div>
        {matches ? (
          <ul className="max-h-[34rem] overflow-auto rounded-lg border border-line bg-inset px-1 py-1">
            {matches.length === 0 && (
              <li className="px-3 py-2 text-2xs text-fg-subtle">
                No files match &quot;{query}&quot;
              </li>
            )}
            {matches.map((f) => (
              <li key={f.path}>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedPath(f.path);
                  }}
                  className={cn(
                    'w-full truncate rounded-sm px-2 py-1 text-left font-mono text-xs',
                    selectedPath === f.path
                      ? 'bg-accent-soft text-accent'
                      : 'text-fg-muted hover:bg-raised/60 hover:text-fg',
                  )}
                >
                  {f.path}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <FileTree
            nodes={project.folderTree}
            selectedPath={selectedPath}
            onSelect={setSelectedPath}
          />
        )}
      </div>
      {selected ? (
        <CodeViewer
          code={selected.content}
          filename={selected.path.split('/').pop() ?? selected.path}
          mime={LANGUAGE_MIME[selected.language]}
          language={selected.language}
        />
      ) : (
        <div className="flex min-h-[20rem] items-center justify-center rounded-lg border border-dashed border-line text-xs text-fg-subtle">
          Select a file to view its contents
        </div>
      )}
    </div>
  );
}

export function BackendWorkspace() {
  const navigate = useNavigate();
  const architecture = usePipelineStore((state) => state.architecture);
  const backend = useGeneratedBackend();

  return (
    <>
      <PageHeader
        variant="section"
        title="Backend"
        description={
          backend.data
            ? `${backend.data.meta.framework} backend for ${backend.data.meta.projectName}.`
            : 'The generation engine turns the design bundle into a complete Express + Prisma backend.'
        }
        actions={
          backend.data ? (
            <Button
              variant="primary"
              icon={<FileArchive className="size-3.5" />}
              onClick={() => {
                downloadZip(
                  `${slugify(backend.data.meta.projectName, 'backend')}-backend.zip`,
                  backend.data.files,
                );
              }}
            >
              Download project.zip
            </Button>
          ) : undefined
        }
      />

      {!architecture && (
        <EmptyState
          icon={<Server className="size-4" />}
          title="No architecture plan yet"
          description="Plan the architecture first — the backend is generated from its design and API contract."
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

      {architecture && (backend.isPending || backend.designPending) && (
        <div className="space-y-3">
          <div className="grid gap-4 sm:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
          <Skeleton className="h-64" />
        </div>
      )}

      {architecture && backend.isError && (
        <Card className="border-danger/40">
          <CardContent className="flex items-start gap-3 py-4">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
            <div>
              <p className="text-sm font-medium text-fg">Generation failed</p>
              <p className="mt-1 text-xs text-fg-muted">
                {backend.error instanceof ApiClientError
                  ? backend.error.message
                  : 'Unexpected error.'}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {backend.data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Files" value={String(backend.data.stats.files)} />
            <Stat label="Modules" value={String(backend.data.stats.modules)} />
            <Stat
              label="Endpoints"
              value={`${backend.data.stats.implementedEndpoints}/${backend.data.stats.endpoints}`}
            />
            <Stat label="Lines" value={backend.data.stats.linesOfCode.toLocaleString()} />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge variant="ember">{backend.data.meta.framework}</Badge>
            <Badge variant="neutral">{backend.data.meta.language}</Badge>
            <Badge variant="neutral">Feature-first Clean Architecture</Badge>
          </div>

          <Section title="Project files">
            <FileExplorer project={backend.data} />
          </Section>

          <Section title={`Modules — ${backend.data.modules.length}`}>
            <ModuleList modules={backend.data.modules} />
          </Section>

          <Section title={`Routes — ${backend.data.routes.length}`}>
            <RouteTable routes={backend.data.routes} />
          </Section>

          <div className="mt-8 flex items-center justify-between gap-3 rounded-lg border border-line bg-surface px-5 py-4">
            <p className="text-xs text-fg-muted">
              This manifest is the input for the Frontend Generation Engine — the next pipeline
              stage.
            </p>
            <Button
              variant="primary"
              icon={<Monitor className="size-3.5" />}
              onClick={() => {
                void navigate('/frontend');
              }}
            >
              Generate frontend
            </Button>
          </div>
        </>
      )}
    </>
  );
}
