import {
  AlertTriangle,
  Database,
  DraftingCompass,
  Download,
  FileJson,
  RefreshCw,
} from 'lucide-react';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import { PageHeader } from '@/shared/components/page-header';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent } from '@/shared/components/ui/card';
import { EmptyState } from '@/shared/components/ui/empty-state';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { downloadText } from '@/shared/lib/download';
import { slugify } from '@/shared/lib/slugify';
import { ApiClientError } from '@/shared/services/api-client';
import { usePipelineStore } from '@/shared/store/pipeline.store';
import type { ArchitectureResponse, NfrScore } from '@/shared/types/api';
import { JsonViewer } from '@/features/prompt/components/json-viewer';
import { ApiExplorer } from './components/api-explorer';
import { DependencyGraph } from './components/dependency-graph';
import { EntityGrid } from './components/entity-grid';
import { FolderTree } from './components/folder-tree';
import { usePlanArchitecture } from './use-plan-architecture';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-sm font-medium text-fg">{title}</h2>
      {children}
    </section>
  );
}

function PlanView({ result }: { result: ArchitectureResponse }) {
  const { plan } = result;
  const decisions = [
    { area: 'Architecture', decision: plan.decisions.architecture },
    { area: 'Frontend', decision: plan.decisions.frontendArchitecture },
    { area: 'Backend', decision: plan.decisions.backendArchitecture },
    { area: 'Database', decision: plan.decisions.database },
    { area: 'Authentication', decision: plan.decisions.authentication },
  ];

  return (
    <>
      <Section title="Decisions">
        <div className="grid gap-4 lg:grid-cols-2">
          {decisions.map(({ area, decision }) => (
            <Card key={area}>
              <CardContent className="px-4 py-3">
                <p className="font-mono text-2xs tracking-widest text-fg-subtle uppercase">
                  {area}
                </p>
                <h3 className="mt-1 text-[0.8125rem] font-medium text-fg">{decision.choice}</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-fg-muted">{decision.reasoning}</p>
                <details className="mt-2">
                  <summary className="cursor-pointer text-2xs text-fg-subtle hover:text-fg-muted">
                    Rejected alternatives ({decision.alternatives.length})
                  </summary>
                  <ul className="mt-1.5 space-y-1">
                    {decision.alternatives.map((alternative) => (
                      <li key={alternative.option} className="text-2xs text-fg-muted">
                        <span className="text-fg">{alternative.option}</span> —{' '}
                        {alternative.rejectedBecause}
                      </li>
                    ))}
                  </ul>
                </details>
              </CardContent>
            </Card>
          ))}
        </div>
      </Section>

      <Section title="Folder structure">
        <FolderTree nodes={plan.folderStructure} />
      </Section>

      <Section title={`API surface — ${plan.apiModules.length} modules`}>
        <ApiExplorer modules={plan.apiModules} />
      </Section>

      <Section
        title={`Database — ${plan.database.entities.length} entities on ${plan.database.engine}`}
      >
        <EntityGrid entities={plan.database.entities} />
        <Card className="mt-4">
          <CardContent className="px-4 py-3">
            <p className="font-mono text-2xs tracking-widest text-fg-subtle uppercase">
              Normalization
            </p>
            <ul className="mt-2 space-y-1.5">
              {plan.database.normalization.map((note) => (
                <li key={note} className="text-xs leading-relaxed text-fg-muted">
                  • {note}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </Section>

      <Section title="Backend building blocks">
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full min-w-[40rem] text-left text-xs">
            <thead>
              <tr className="border-b border-line font-mono text-2xs tracking-wide text-fg-subtle uppercase">
                <th className="px-4 py-2.5 font-medium">Module</th>
                <th className="px-4 py-2.5 font-medium">Controller</th>
                <th className="px-4 py-2.5 font-medium">Service</th>
                <th className="px-4 py-2.5 font-medium">Repository</th>
                <th className="px-4 py-2.5 font-medium">DTOs</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {plan.services.map((service) => (
                <tr key={service.module}>
                  <td className="px-4 py-2.5 font-medium text-fg">{service.module}</td>
                  <td className="px-4 py-2.5 font-mono text-2xs text-fg-muted">
                    {service.controller}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-2xs text-fg-muted">
                    {service.service}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-2xs text-fg-muted">
                    {service.repository}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-2xs text-fg-muted">
                    {service.dtos.join(', ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {plan.middleware.map((mw) => (
            <Badge key={mw.name} variant="neutral" title={mw.purpose}>
              {mw.name}
            </Badge>
          ))}
        </div>
      </Section>

      <Section title="Module dependencies">
        <DependencyGraph graph={plan.dependencyGraph} />
      </Section>

      <Section title="Security posture">
        <Card>
          <CardContent className="grid gap-x-8 gap-y-3 px-4 py-4 sm:grid-cols-2">
            {[
              ['Authentication', plan.security.authentication.join(', ')],
              ['Sessions', plan.security.sessionStrategy],
              ['Authorization', plan.security.authorization],
              ['Passwords', plan.security.passwordPolicy.join(' · ')],
              ['Rate limiting', plan.security.rateLimiting.join(' · ')],
              ['Validation', plan.security.validation],
              ['Headers', plan.security.headers.join(' · ')],
              ['CORS', plan.security.cors],
            ].map(([label, value]) => (
              <div key={label}>
                <p className="font-mono text-2xs tracking-widest text-fg-subtle uppercase">
                  {label}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-fg-muted">{value}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </Section>

      <Section title="Scalability & quality targets">
        <ul className="space-y-2">
          {plan.futureScalability.map((item) => (
            <li
              key={item.concern}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg border border-line bg-surface px-4 py-2.5"
            >
              <span className="w-40 shrink-0 text-xs font-medium text-fg">{item.concern}</span>
              <span className="min-w-0 flex-1 text-xs text-fg-muted">{item.recommendation}</span>
              <span className="font-mono text-2xs text-fg-subtle">{item.trigger}</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {(
            [
              ['performance', plan.nonFunctional.performance],
              ['maintainability', plan.nonFunctional.maintainability],
              ['security', plan.nonFunctional.security],
              ['scalability', plan.nonFunctional.scalability],
              ['availability', plan.nonFunctional.availability],
              ['reliability', plan.nonFunctional.reliability],
            ] as [string, NfrScore][]
          ).map(([quality, value]) => (
            <Card key={quality}>
              <CardContent className="px-4 py-3">
                <div className="flex items-baseline justify-between">
                  <p className="text-xs font-medium text-fg capitalize">{quality}</p>
                  <p className="font-mono text-sm text-ember tabular-nums">{value.score}/10</p>
                </div>
                <p className="mt-1 text-2xs leading-relaxed text-fg-muted">{value.notes}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </Section>

      <Section title="Raw plan">
        <JsonViewer
          value={plan}
          exportName={`${slugify(plan.meta.projectName, 'architecture')}-architecture`}
        />
      </Section>
    </>
  );
}

export function ArchitectureWorkspace() {
  const navigate = useNavigate();
  const spec = usePipelineStore((state) => state.spec);
  const setArchitecture = usePipelineStore((state) => state.setArchitecture);
  const planner = usePlanArchitecture();
  const { mutate } = planner;

  // Plan automatically whenever the working spec changes.
  useEffect(() => {
    if (spec) mutate(spec);
  }, [spec, mutate]);

  // Publish the plan downstream so the Database view can design from it.
  useEffect(() => {
    if (planner.data) setArchitecture(planner.data.plan);
  }, [planner.data, setArchitecture]);

  return (
    <>
      <PageHeader
        variant="section"
        title="Architecture"
        description={
          spec
            ? `Software Design Specification for ${spec.projectName} (${spec.projectType}).`
            : 'The planner turns an analyzed requirement spec into a full design specification.'
        }
        actions={
          planner.data ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                icon={<RefreshCw className="size-3.5" />}
                onClick={() => {
                  if (spec) mutate(spec);
                }}
              >
                Re-plan
              </Button>
              <Button
                icon={<FileJson className="size-3.5" />}
                onClick={() => {
                  downloadText(
                    `${slugify(planner.data.plan.meta.projectName, 'architecture')}-architecture.json`,
                    JSON.stringify(planner.data.plan, null, 2),
                    'application/json',
                  );
                }}
              >
                Export JSON
              </Button>
              <Button
                variant="primary"
                icon={<Download className="size-3.5" />}
                onClick={() => {
                  downloadText(
                    `${slugify(planner.data.plan.meta.projectName, 'architecture')}-sds.md`,
                    planner.data.markdown,
                    'text/markdown',
                  );
                }}
              >
                Export SDS (.md)
              </Button>
            </>
          ) : undefined
        }
      />

      {!spec && (
        <EmptyState
          icon={<DraftingCompass className="size-4" />}
          title="No requirement spec yet"
          description="The architecture is planned from an analyzed requirement spec. Build this project and it appears here."
          action={
            <Button
              variant="forge"
              onClick={() => {
                void navigate('..', { relative: 'path' });
              }}
            >
              Back to the project
            </Button>
          }
        />
      )}

      {spec && planner.isPending && (
        <div className="space-y-3">
          <div className="grid gap-4 lg:grid-cols-2">
            <Skeleton className="h-36" />
            <Skeleton className="h-36" />
          </div>
          <Skeleton className="h-64" />
        </div>
      )}

      {spec && planner.isError && (
        <Card className="border-danger/40">
          <CardContent className="flex items-start gap-3 py-4">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
            <div>
              <p className="text-sm font-medium text-fg">Planning failed</p>
              <p className="mt-1 text-xs text-fg-muted">
                {planner.error instanceof ApiClientError
                  ? planner.error.message
                  : 'Unexpected error — try re-planning.'}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {planner.data && <PlanView result={planner.data} />}

      {planner.data && (
        <div className="mt-8 flex items-center justify-between gap-3 rounded-lg border border-line bg-surface px-5 py-4">
          <p className="text-xs text-fg-muted">
            This plan is the input for the Database Designer — the next pipeline stage.
          </p>
          <Button
            variant="primary"
            icon={<Database className="size-3.5" />}
            onClick={() => {
              void navigate('/database');
            }}
          >
            Design database
          </Button>
        </div>
      )}
    </>
  );
}
