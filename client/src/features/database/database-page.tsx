import { AlertTriangle, Database, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { PageHeader } from '@/shared/components/page-header';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent } from '@/shared/components/ui/card';
import { EmptyState } from '@/shared/components/ui/empty-state';
import { Input } from '@/shared/components/ui/input';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { useDocumentTitle } from '@/shared/hooks/use-document-title';
import { cn } from '@/shared/lib/cn';
import { ApiClientError } from '@/shared/services/api-client';
import { usePipelineStore } from '@/shared/store/pipeline.store';
import type { DesignBundle } from '@/shared/types/api';
import { CodeViewer } from './components/code-viewer';
import { EntityDetail } from './components/entity-detail';
import { ErDiagramView } from './components/er-diagram-view';
import { ExportBar } from './components/export-bar';
import { useDesignBundle } from './use-design';

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'schema'
  );
}

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

function EntityExplorer({ bundle }: { bundle: DesignBundle }) {
  const tables = bundle.databaseDesign.tables;
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(tables[0]?.entity ?? '');

  const filtered = useMemo(
    () => tables.filter((t) => t.entity.toLowerCase().includes(query.trim().toLowerCase())),
    [tables, query],
  );
  const active = tables.find((t) => t.entity === selected) ?? filtered[0] ?? tables[0];

  return (
    <div className="grid gap-4 md:grid-cols-[16rem_1fr]">
      <div>
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-subtle" />
          <Input
            type="search"
            placeholder="Search entities"
            aria-label="Search entities"
            className="pl-8"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
        </div>
        <ul className="max-h-[30rem] overflow-auto rounded-lg border border-line bg-surface">
          {filtered.map((table) => (
            <li key={table.entity}>
              <button
                type="button"
                onClick={() => {
                  setSelected(table.entity);
                }}
                className={cn(
                  'flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors',
                  active?.entity === table.entity
                    ? 'bg-raised text-fg'
                    : 'text-fg-muted hover:bg-raised/50',
                )}
              >
                <span className="truncate text-xs font-medium">{table.entity}</span>
                <span className="font-mono text-2xs text-fg-subtle">{table.columns.length}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <Card>
        <CardContent>{active && <EntityDetail table={active} />}</CardContent>
      </Card>
    </div>
  );
}

function DesignView({ bundle }: { bundle: DesignBundle }) {
  const { databaseDesign: design, integrity } = bundle;

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Tables" value={String(integrity.stats.tables)} />
        <Stat label="Relationships" value={String(integrity.stats.relationships)} />
        <Stat label="Indexes" value={String(integrity.stats.indexes)} />
        <Stat label="Endpoints" value={String(integrity.stats.endpoints)} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Badge variant={integrity.valid ? 'success' : 'danger'}>
          {integrity.valid ? 'Integrity valid' : `${integrity.issues.length} issues`}
        </Badge>
        <Badge variant="neutral">{design.meta.engine}</Badge>
        <Badge variant="neutral">{design.meta.normalForm}</Badge>
        <Badge variant="ember">{design.enums.length} enums</Badge>
      </div>

      <Section title="Entities">
        <EntityExplorer bundle={bundle} />
      </Section>

      <Section title="ER diagram">
        <ErDiagramView diagram={bundle.erDiagram} />
      </Section>

      <Section title="Prisma schema">
        <CodeViewer
          code={bundle.prismaSchema}
          filename="schema.prisma"
          mime="text/plain"
          language="prisma"
        />
      </Section>

      <Section title="SQL schema">
        <CodeViewer
          code={bundle.sqlSchema}
          filename="schema.sql"
          mime="application/sql"
          language="sql"
        />
      </Section>

      <Section title="Optimization">
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardContent className="py-4">
              <p className="font-mono text-2xs tracking-widest text-fg-subtle uppercase">
                Caching candidates
              </p>
              {design.optimization.cachingCandidates.length > 0 ? (
                <ul className="mt-2 space-y-1.5">
                  {design.optimization.cachingCandidates.map((c) => (
                    <li key={c.table} className="text-xs text-fg-muted">
                      <code className="text-fg">{c.table}</code> — {c.reason}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-xs text-fg-subtle">
                  None — no read-mostly reference tables.
                </p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <p className="font-mono text-2xs tracking-widest text-fg-subtle uppercase">
                Partitioning candidates
              </p>
              {design.optimization.partitioningCandidates.length > 0 ? (
                <ul className="mt-2 space-y-1.5">
                  {design.optimization.partitioningCandidates.map((c) => (
                    <li key={c.table} className="text-xs text-fg-muted">
                      <code className="text-fg">{c.table}</code> — {c.strategy}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-xs text-fg-subtle">None — no high-volume append tables.</p>
              )}
            </CardContent>
          </Card>
        </div>
        <Card className="mt-4">
          <CardContent className="py-4">
            <p className="font-mono text-2xs tracking-widest text-fg-subtle uppercase">
              Query guidelines
            </p>
            <ul className="mt-2 space-y-1.5">
              {design.optimization.queryGuidelines.map((g) => (
                <li key={g} className="text-xs leading-relaxed text-fg-muted">
                  • {g}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </Section>
    </>
  );
}

export function DatabasePage() {
  useDocumentTitle('Database');
  const navigate = useNavigate();
  const architecture = usePipelineStore((state) => state.architecture);
  const design = useDesignBundle();

  return (
    <>
      <PageHeader
        eyebrow="console/database"
        title="Database"
        description={
          architecture
            ? `Relational design for ${architecture.meta.projectName} (${architecture.meta.projectType}).`
            : 'The designer turns the architecture plan into schemas, an ER diagram and API contracts.'
        }
        actions={
          design.data ? (
            <ExportBar
              bundle={design.data}
              slug={slugify(architecture?.meta.projectName ?? 'schema')}
            />
          ) : undefined
        }
      />

      {!architecture && (
        <EmptyState
          icon={<Database className="size-4" />}
          title="No architecture plan yet"
          description="Plan the architecture first — its design specification flows here automatically."
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
          <div className="grid gap-4 sm:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
          <Skeleton className="h-64" />
        </div>
      )}

      {architecture && design.isError && (
        <Card className="border-danger/40">
          <CardContent className="flex items-start gap-3 py-4">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
            <div>
              <p className="text-sm font-medium text-fg">Design failed</p>
              <p className="mt-1 text-xs text-fg-muted">
                {design.error instanceof ApiClientError
                  ? design.error.message
                  : 'Unexpected error.'}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {design.data && <DesignView bundle={design.data} />}
    </>
  );
}
