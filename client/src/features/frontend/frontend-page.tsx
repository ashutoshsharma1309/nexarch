import {
  AlertTriangle,
  FileArchive,
  Layers,
  Monitor,
  Search,
  ShieldCheck,
  Smartphone,
  Tablet,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { FileTree } from '@/features/backend/components/file-tree';
import { CodeViewer } from '@/features/database/components/code-viewer';
import { PageHeader } from '@/shared/components/page-header';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent } from '@/shared/components/ui/card';
import { EmptyState } from '@/shared/components/ui/empty-state';
import { Input } from '@/shared/components/ui/input';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { useDocumentTitle } from '@/shared/hooks/use-document-title';
import { cn } from '@/shared/lib/cn';
import { slugify } from '@/shared/lib/slugify';
import { downloadZip } from '@/shared/lib/zip';
import { ApiClientError } from '@/shared/services/api-client';
import { usePipelineStore } from '@/shared/store/pipeline.store';
import type { FrontendFileLanguage, GeneratedFrontend } from '@/shared/types/api';
import { PageList } from './components/page-list';
import { RouteList } from './components/route-list';
import { useGeneratedFrontend } from './use-generated-frontend';

const LANGUAGE_MIME: Record<FrontendFileLanguage, string> = {
  typescript: 'text/typescript',
  typescriptreact: 'text/typescript',
  json: 'application/json',
  markdown: 'text/markdown',
  css: 'text/css',
  env: 'text/plain',
  ignore: 'text/plain',
  javascript: 'text/javascript',
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

function FileExplorer({ project }: { project: GeneratedFrontend }) {
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

function ComponentTree({ project }: { project: GeneratedFrontend }) {
  const groups: { kind: 'ui' | 'layout' | 'feature'; label: string }[] = [
    { kind: 'ui', label: 'Design system' },
    { kind: 'layout', label: 'Layouts' },
    { kind: 'feature', label: 'Feature components' },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {groups.map((group) => {
        const items = project.components.filter((c) => c.kind === group.kind);
        return (
          <Card key={group.kind}>
            <CardContent className="py-4">
              <p className="font-mono text-2xs tracking-widest text-fg-subtle uppercase">
                {group.label} · {items.length}
              </p>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {items.map((item) => (
                  <Badge key={item.file} variant="neutral" title={item.file}>
                    {item.name}
                  </Badge>
                ))}
              </ul>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

const BREAKPOINTS = [
  { icon: Smartphone, label: 'Mobile', hint: 'Base — drawer nav, single-column' },
  { icon: Tablet, label: 'md — 768px', hint: 'Two-column settings, wider dialogs' },
  { icon: Monitor, label: 'lg — 1024px', hint: 'Static sidebar rail, full dashboard grid' },
];

function ResponsivePreview() {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {BREAKPOINTS.map(({ icon: Icon, label, hint }) => (
        <Card key={label}>
          <CardContent className="flex items-start gap-3 py-4">
            <Icon className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
            <div>
              <p className="text-xs font-medium text-fg">{label}</p>
              <p className="mt-0.5 text-2xs text-fg-muted">{hint}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function FrontendPage() {
  useDocumentTitle('Frontend');
  const navigate = useNavigate();
  const architecture = usePipelineStore((state) => state.architecture);
  const frontend = useGeneratedFrontend();

  return (
    <>
      <PageHeader
        eyebrow="console/frontend"
        title="Frontend"
        description={
          frontend.data
            ? `${frontend.data.meta.framework} console for ${frontend.data.meta.projectName}.`
            : 'The generation engine turns the design bundle and backend manifest into a complete React console.'
        }
        actions={
          frontend.data ? (
            <Button
              variant="primary"
              icon={<FileArchive className="size-3.5" />}
              onClick={() => {
                downloadZip(
                  `${slugify(frontend.data.meta.projectName, 'frontend')}-frontend.zip`,
                  frontend.data.files,
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
          icon={<Layers className="size-4" />}
          title="No architecture plan yet"
          description="Plan the architecture first — the frontend is generated from the design bundle and backend manifest."
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

      {architecture && (frontend.isPending || frontend.upstreamPending) && (
        <div className="space-y-3">
          <div className="grid gap-4 sm:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
          <Skeleton className="h-64" />
        </div>
      )}

      {architecture && frontend.isError && (
        <Card className="border-danger/40">
          <CardContent className="flex items-start gap-3 py-4">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
            <div>
              <p className="text-sm font-medium text-fg">Generation failed</p>
              <p className="mt-1 text-xs text-fg-muted">
                {frontend.error instanceof ApiClientError
                  ? frontend.error.message
                  : 'Unexpected error.'}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {frontend.data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Files" value={String(frontend.data.stats.files)} />
            <Stat label="Pages" value={String(frontend.data.stats.pages)} />
            <Stat label="Components" value={String(frontend.data.stats.components)} />
            <Stat label="Lines" value={frontend.data.stats.linesOfCode.toLocaleString()} />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge variant="ember">{frontend.data.meta.framework}</Badge>
            <Badge variant="neutral">{frontend.data.meta.language}</Badge>
            <Badge variant="neutral">Tailwind CSS 4</Badge>
            <Badge variant="neutral">TanStack Query</Badge>
          </div>

          <Section title="Project files">
            <FileExplorer project={frontend.data} />
          </Section>

          <Section title={`Pages — ${frontend.data.pages.length}`}>
            <PageList pages={frontend.data.pages} />
          </Section>

          <Section title="Component tree">
            <ComponentTree project={frontend.data} />
          </Section>

          <Section title={`Routes — ${frontend.data.routes.length}`}>
            <RouteList routes={frontend.data.routes} />
          </Section>

          <Section title="Responsive behavior">
            <ResponsivePreview />
          </Section>

          <div className="mt-8 flex items-center justify-between gap-3 rounded-lg border border-line bg-surface px-5 py-4">
            <p className="text-xs text-fg-muted">
              This frontend is the input for the Security Engine — the next pipeline stage.
            </p>
            <Button
              variant="primary"
              icon={<ShieldCheck className="size-3.5" />}
              onClick={() => {
                void navigate('/security');
              }}
            >
              Run security audit
            </Button>
          </div>
        </>
      )}
    </>
  );
}
