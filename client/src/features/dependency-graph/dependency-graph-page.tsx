import {
  AlertTriangle,
  Bot,
  Coins,
  GitBranch,
  Layers,
  Network,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { PageHeader } from '@/shared/components/page-header';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { EmptyState } from '@/shared/components/ui/empty-state';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { Textarea } from '@/shared/components/ui/textarea';
import { ApiClientError } from '@/shared/services/api-client';
import { usePipelineStore } from '@/shared/store/pipeline.store';
import type {
  AffectedFile,
  ImpactAnalysis,
  ModuleGroup,
  SpecDiffAnalysis,
} from '@/shared/types/api';
import { GraphCanvas } from './components/graph-canvas';
import { useDependencyGraph, useImpactAnalysis, useSpecDiff } from './use-dependency-graph';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-sm font-medium text-fg">{title}</h2>
      {children}
    </section>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between py-3">
        <div>
          <p className="font-mono text-2xs tracking-widest text-fg-subtle uppercase">{label}</p>
          <p className="mt-1 text-xl font-semibold text-fg tabular-nums">{value}</p>
        </div>
        {icon && <div className="text-fg-subtle">{icon}</div>}
      </CardContent>
    </Card>
  );
}

const GROUP_LABEL: Record<ModuleGroup, string> = {
  frontend: 'Frontend',
  backend: 'Backend',
  database: 'Database',
  security: 'Security',
  shared: 'Configuration',
};

function AffectedFileRow({ file }: { file: AffectedFile }) {
  return (
    <li className="flex items-center gap-2 rounded-sm border border-line bg-inset px-3 py-1.5 font-mono text-2xs text-fg-muted">
      <Badge variant="neutral">{GROUP_LABEL[file.group]}</Badge>
      <span className="truncate text-fg">{file.path}</span>
    </li>
  );
}

function ImpactPanel({ impact }: { impact: ImpactAnalysis }) {
  const modules = impact.modulesAffected;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="ember">{impact.classification.category}</Badge>
        <span className="text-2xs text-fg-subtle">
          confidence {Math.round(impact.classification.confidence * 100)}%
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Files affected"
          value={String(impact.tokenOptimization.affectedFiles)}
          icon={<Layers className="size-4" />}
        />
        <Stat
          label="Files untouched"
          value={String(impact.unaffectedFileCount)}
          icon={<Network className="size-4" />}
        />
        <Stat
          label="Tokens saved"
          value={`${impact.tokenOptimization.savingsPercent}%`}
          icon={<Coins className="size-4" />}
        />
        <Stat
          label="Est. cost saved"
          value={`$${impact.tokenOptimization.estimatedCostSavedUsd.toFixed(4)}`}
          icon={<Sparkles className="size-4" />}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {(Object.keys(modules) as (keyof typeof modules)[])
          .filter((key) => modules[key].length > 0)
          .map((key) => (
            <div key={key} className="rounded-lg border border-line bg-surface p-3">
              <p className="font-mono text-2xs tracking-widest text-fg-subtle uppercase">{key}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {modules[key].map((label) => (
                  <Badge key={label} variant="neutral">
                    {label}
                  </Badge>
                ))}
              </div>
            </div>
          ))}
      </div>

      <div>
        <p className="mb-1.5 text-xs font-medium text-fg">
          Affected files — {impact.affectedFiles.length}
        </p>
        <ul className="max-h-64 space-y-1 overflow-auto">
          {impact.affectedFiles.map((file) => (
            <AffectedFileRow key={file.nodeId} file={file} />
          ))}
        </ul>
      </div>
    </div>
  );
}

function SpecDiffPanel({ analysis }: { analysis: SpecDiffAnalysis }) {
  if (analysis.diff.identical) {
    return (
      <p className="text-xs text-fg-muted">
        {analysis.diff.summary} All {analysis.plan.preservedFileCount} files stay untouched.
      </p>
    );
  }

  const changedCategories = analysis.diff.categories.filter(
    (category) => category.added.length > 0 || category.removed.length > 0,
  );

  return (
    <div className="space-y-4">
      <p className="text-xs text-fg-muted">{analysis.diff.summary}</p>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Regenerate" value={String(analysis.plan.regenerateCount)} />
        <Stat label="Preserved" value={String(analysis.plan.preservedFileCount)} />
        <Stat
          label="Recommendation"
          value={analysis.plan.fullRebuildRecommended ? 'Full rebuild' : 'Selective'}
        />
      </div>

      {analysis.plan.fullRebuildRecommended && (
        <p className="text-xs text-warning">
          More than half the project is affected — a full regeneration is cheaper than a selective
          merge here.
        </p>
      )}

      <div className="space-y-2">
        {changedCategories.map((category) => (
          <div key={category.category} className="rounded-md border border-line bg-raised/40 p-3">
            <p className="text-xs font-medium text-fg capitalize">{category.category}</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {category.added.map((item) => (
                <Badge key={`+${item}`} variant="success">
                  + {item}
                </Badge>
              ))}
              {category.removed.map((item) => (
                <Badge key={`-${item}`} variant="danger">
                  − {item}
                </Badge>
              ))}
            </div>
          </div>
        ))}
      </div>

      {analysis.plan.filesToRegenerate.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-fg">
            Files to regenerate ({analysis.plan.filesToRegenerate.length})
          </p>
          <div className="max-h-56 space-y-1 overflow-y-auto">
            {analysis.plan.filesToRegenerate.map((file) => (
              <AffectedFileRow key={file.path} file={file} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function DependencyGraphWorkspace() {
  const navigate = useNavigate();
  const architecture = usePipelineStore((state) => state.architecture);
  const graph = useDependencyGraph();
  const impactMutation = useImpactAnalysis();
  const specDiff = useSpecDiff();
  const [changeRequest, setChangeRequest] = useState('');
  const [newPrompt, setNewPrompt] = useState('');

  const impactNodeIds = impactMutation.data
    ? new Set(impactMutation.data.affectedNodeIds)
    : undefined;

  return (
    <>
      <PageHeader
        variant="section"
        title="Dependency Graph"
        description={
          graph.data
            ? `${graph.data.stats.totalNodes} nodes and ${graph.data.stats.totalEdges} edges across ${graph.data.meta.projectName}.`
            : 'Maps how every page, route, controller, service, table, and config value in the generated project depends on the others — so a future change only touches what it actually affects.'
        }
      />

      {!architecture && (
        <EmptyState
          icon={<GitBranch className="size-4" />}
          title="No architecture plan yet"
          description="Plan the architecture first — the dependency graph is built from the full generation pipeline."
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

      {architecture && (graph.isPending || graph.upstreamPending) && (
        <div className="space-y-3">
          <div className="grid gap-4 sm:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
          <Skeleton className="h-96" />
        </div>
      )}

      {architecture && graph.isError && (
        <Card className="border-danger/40">
          <CardContent className="flex items-start gap-3 py-4">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
            <div>
              <p className="text-sm font-medium text-fg">Graph build failed</p>
              <p className="mt-1 text-xs text-fg-muted">
                {graph.error instanceof ApiClientError ? graph.error.message : 'Unexpected error.'}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {graph.data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Stat label="Nodes" value={String(graph.data.stats.totalNodes)} />
            <Stat label="Edges" value={String(graph.data.stats.totalEdges)} />
            <Stat label="Avg depth" value={String(graph.data.stats.averageDependencyDepth)} />
            <Stat label="Circular deps" value={String(graph.data.stats.circularDependencyCount)} />
            <Stat label="Orphan files" value={String(graph.data.stats.orphanFileCount)} />
          </div>

          <Section title="Interactive graph">
            <GraphCanvas
              graph={graph.data.graph}
              layout={graph.data.layout}
              impactNodeIds={impactNodeIds}
            />
          </Section>

          <Section title="Change impact simulation">
            <Card>
              <CardHeader>
                <CardTitle>Describe a change</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Textarea
                  placeholder='e.g. "Add Google Login" or "Add dark mode"'
                  value={changeRequest}
                  onChange={(event) => {
                    setChangeRequest(event.target.value);
                  }}
                  rows={2}
                />
                <Button
                  variant="primary"
                  loading={impactMutation.isPending}
                  disabled={changeRequest.trim().length < 3}
                  onClick={() => {
                    impactMutation.mutate(changeRequest);
                  }}
                >
                  Analyze impact
                </Button>

                {impactMutation.isError && (
                  <p className="text-xs text-danger">
                    {impactMutation.error instanceof ApiClientError
                      ? impactMutation.error.message
                      : 'Unexpected error.'}
                  </p>
                )}
                {impactMutation.data && <ImpactPanel impact={impactMutation.data} />}
              </CardContent>
            </Card>
          </Section>

          <Section title="Prompt-diff regeneration">
            <Card>
              <CardHeader>
                <CardTitle>Evolve the prompt</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-fg-muted">
                  Paste the evolved project prompt — it is analyzed into a spec, diffed against the
                  spec this project was built from, and only what actually changed gets regenerated.
                </p>
                <Textarea
                  placeholder="The full new prompt, e.g. the original plus “…and barcode scanning with SMS alerts”"
                  value={newPrompt}
                  onChange={(event) => {
                    setNewPrompt(event.target.value);
                  }}
                  rows={3}
                />
                <Button
                  variant="primary"
                  loading={specDiff.isPending}
                  disabled={newPrompt.trim().length < 10}
                  onClick={() => {
                    specDiff.mutate(newPrompt);
                  }}
                >
                  Diff against current project
                </Button>

                {specDiff.isError && (
                  <p className="text-xs text-danger">
                    {specDiff.error instanceof Error ? specDiff.error.message : 'Unexpected error.'}
                  </p>
                )}
                {specDiff.data && <SpecDiffPanel analysis={specDiff.data} />}
              </CardContent>
            </Card>
          </Section>

          <Section title="Quality report">
            <Card>
              <CardContent className="space-y-3 py-4">
                <ul className="space-y-1.5">
                  {graph.data.quality.recommendations.map((rec) => (
                    <li key={rec} className="flex items-start gap-2 text-xs text-fg-muted">
                      <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-fg-subtle" />
                      {rec}
                    </li>
                  ))}
                </ul>
                {graph.data.quality.duplicateGroups.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 border-t border-line pt-3">
                    {graph.data.quality.duplicateGroups.map((group) => (
                      <Badge key={group.nodeIds.join(',')} variant="warning">
                        {group.kind}: {group.label}
                      </Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </Section>

          <div className="mt-8 flex items-center justify-between gap-3 rounded-lg border border-line bg-surface px-5 py-4">
            <p className="text-xs text-fg-muted">
              This graph is what the AI Orchestrator uses to scope context for any future change —
              the next pipeline stage.
            </p>
            <Button
              variant="primary"
              icon={<Bot className="size-3.5" />}
              onClick={() => {
                void navigate('/ai-operations');
              }}
            >
              Open AI Operations
            </Button>
          </div>
        </>
      )}
    </>
  );
}
