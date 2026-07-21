import {
  AlertTriangle,
  Bot,
  Coins,
  Database,
  Gauge,
  RefreshCw,
  Sparkles,
  Workflow,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import { PageHeader } from '@/shared/components/page-header';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { Textarea } from '@/shared/components/ui/textarea';
import { useDocumentTitle } from '@/shared/hooks/use-document-title';
import { cn } from '@/shared/lib/cn';
import { ApiClientError } from '@/shared/services/api-client';
import type {
  AiGenerationStatus,
  AiTaskComplexity,
  AiWorkflowStepStatus,
} from '@/shared/types/api';
import {
  useAiStatistics,
  useGenerate,
  useGenerationHistory,
  useRunWorkflow,
} from './use-ai-orchestrator';

interface PromptTemplateMeta {
  id: string;
  label: string;
  complexity: AiTaskComplexity;
  variables: string[];
  workflowStep: string;
}

const PROMPT_TEMPLATES: PromptTemplateMeta[] = [
  {
    id: 'requirement-analyzer',
    label: 'Requirement Analyzer',
    complexity: 'simple-extraction',
    variables: ['PROJECT_NAME', 'USER_REQUEST'],
    workflowStep: 'requirement-analysis',
  },
  {
    id: 'architecture-planner',
    label: 'Architecture Planner',
    complexity: 'large-planning',
    variables: ['PROJECT_NAME', 'PROJECT_TYPE', 'REQUIREMENT_SPEC'],
    workflowStep: 'architecture',
  },
  {
    id: 'database-generator',
    label: 'Database Designer',
    complexity: 'large-planning',
    variables: ['PROJECT_NAME', 'DATABASE', 'ARCHITECTURE_PLAN'],
    workflowStep: 'database',
  },
  {
    id: 'backend-generator',
    label: 'Backend Generator',
    complexity: 'complex-refactor',
    variables: ['PROJECT_NAME', 'MODULE', 'DESIGN_BUNDLE'],
    workflowStep: 'backend',
  },
  {
    id: 'frontend-generator',
    label: 'Frontend Generator',
    complexity: 'complex-refactor',
    variables: ['PROJECT_NAME', 'FEATURE', 'DESIGN_BUNDLE'],
    workflowStep: 'frontend',
  },
  {
    id: 'security-engine',
    label: 'Security Engine',
    complexity: 'complex-refactor',
    variables: ['PROJECT_NAME', 'PROJECT_MANIFEST'],
    workflowStep: 'security',
  },
  {
    id: 'dependency-engine',
    label: 'Dependency Graph Engine',
    complexity: 'small-file-regen',
    variables: ['PROJECT_NAME', 'FEATURE', 'DEPENDENCY_GRAPH'],
    workflowStep: 'dependency-graph',
  },
];

const PIPELINE_STEPS = [...PROMPT_TEMPLATES.map((t) => t.workflowStep), 'export'];

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

const STATUS_VARIANT: Record<AiGenerationStatus, 'success' | 'danger' | 'accent'> = {
  success: 'success',
  failed: 'danger',
  cached: 'accent',
};

const STEP_STATUS_VARIANT: Record<
  AiWorkflowStepStatus,
  'success' | 'danger' | 'warning' | 'neutral'
> = {
  completed: 'success',
  failed: 'danger',
  running: 'warning',
  pending: 'neutral',
  skipped: 'neutral',
};

export function AiOrchestratorPage() {
  useDocumentTitle('AI Operations');

  const history = useGenerationHistory();
  const statistics = useAiStatistics();
  const generateMutation = useGenerate();
  const workflowMutation = useRunWorkflow();

  const [selectedTemplateId, setSelectedTemplateId] = useState(PROMPT_TEMPLATES[0]?.id ?? '');
  const template = useMemo(
    () => PROMPT_TEMPLATES.find((t) => t.id === selectedTemplateId) ?? PROMPT_TEMPLATES[0],
    [selectedTemplateId],
  );
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});

  const setVariable = (name: string, value: string): void => {
    setVariableValues((prev) => ({ ...prev, [name]: value }));
  };

  const canSubmit = template
    ? template.variables.every((v) => (variableValues[v] ?? '').trim().length > 0)
    : false;

  return (
    <>
      <PageHeader
        eyebrow="console/ai-operations"
        title="AI Operations"
        description="The single entry point for every AI interaction in NexArch — prompt templates, provider-agnostic routing, caching, retries, and generation history."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat
          label="Generations"
          value={statistics.data ? String(statistics.data.totalGenerations) : '—'}
          icon={<Bot className="size-4" />}
        />
        <Stat
          label="Total tokens"
          value={statistics.data ? statistics.data.totalTokens.toLocaleString() : '—'}
          icon={<Gauge className="size-4" />}
        />
        <Stat
          label="Total cost"
          value={statistics.data ? `$${statistics.data.totalCostUsd.toFixed(4)}` : '—'}
          icon={<Coins className="size-4" />}
        />
        <Stat
          label="Cache hit rate"
          value={statistics.data ? `${statistics.data.cache.hitRate}%` : '—'}
          icon={<RefreshCw className="size-4" />}
        />
        <Stat
          label="Avg duration"
          value={statistics.data ? `${statistics.data.averageDurationMs}ms` : '—'}
          icon={<Sparkles className="size-4" />}
        />
      </div>

      <Section title="Prompt templates">
        <Card>
          <CardHeader>
            <CardTitle>Run a template</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-1.5">
              {PROMPT_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setSelectedTemplateId(t.id);
                    setVariableValues({});
                  }}
                  className={cn(
                    'rounded-sm border px-2.5 py-1 font-mono text-2xs uppercase',
                    t.id === selectedTemplateId
                      ? 'border-accent bg-accent-soft text-accent'
                      : 'border-line text-fg-muted hover:text-fg',
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {template && (
              <>
                <Badge variant="neutral">{template.complexity}</Badge>
                <div className="grid gap-3 sm:grid-cols-2">
                  {template.variables.map((name) => (
                    <div key={name}>
                      <Label htmlFor={name}>{`{{${name}}}`}</Label>
                      {name.endsWith('_REQUEST') ||
                      name.endsWith('_BUNDLE') ||
                      name.endsWith('_SPEC') ||
                      name.endsWith('_PLAN') ||
                      name.endsWith('_GRAPH') ||
                      name.endsWith('_MANIFEST') ? (
                        <Textarea
                          id={name}
                          rows={2}
                          value={variableValues[name] ?? ''}
                          onChange={(event) => {
                            setVariable(name, event.target.value);
                          }}
                        />
                      ) : (
                        <Input
                          id={name}
                          value={variableValues[name] ?? ''}
                          onChange={(event) => {
                            setVariable(name, event.target.value);
                          }}
                        />
                      )}
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="primary"
                    loading={generateMutation.isPending}
                    disabled={!canSubmit}
                    onClick={() => {
                      generateMutation.mutate({
                        promptId: template.id,
                        variables: variableValues,
                        complexity: template.complexity,
                      });
                    }}
                  >
                    Generate
                  </Button>
                  <Button
                    variant="secondary"
                    icon={<Workflow className="size-3.5" />}
                    loading={workflowMutation.isPending}
                    disabled={!canSubmit}
                    onClick={() => {
                      workflowMutation.mutate({
                        workflowId: 'full-pipeline',
                        steps: [{ name: template.workflowStep, variables: variableValues }],
                      });
                    }}
                  >
                    Run as workflow step
                  </Button>
                </div>

                {generateMutation.isError && (
                  <p className="text-xs text-danger">
                    {generateMutation.error instanceof ApiClientError
                      ? generateMutation.error.message
                      : 'Unexpected error.'}
                  </p>
                )}
                {generateMutation.data && (
                  <div className="rounded-lg border border-line bg-inset p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={STATUS_VARIANT[generateMutation.data.record.status]}>
                        {generateMutation.data.record.status}
                      </Badge>
                      <Badge variant="neutral">
                        {generateMutation.data.record.provider} ·{' '}
                        {generateMutation.data.record.model}
                      </Badge>
                      <Badge variant="neutral">
                        {generateMutation.data.record.tokens.inputTokens +
                          generateMutation.data.record.tokens.outputTokens}{' '}
                        tokens
                      </Badge>
                      <Badge variant="neutral">
                        ${generateMutation.data.record.cost.totalCostUsd.toFixed(6)}
                      </Badge>
                      {generateMutation.data.record.cacheHit && (
                        <Badge variant="accent">cache hit</Badge>
                      )}
                      {generateMutation.data.record.retries > 0 && (
                        <Badge variant="warning">
                          {generateMutation.data.record.retries} retries
                        </Badge>
                      )}
                      <Badge
                        variant={
                          generateMutation.data.record.validation.valid ? 'success' : 'danger'
                        }
                      >
                        {generateMutation.data.record.validation.valid
                          ? 'valid response'
                          : 'validation failed'}
                      </Badge>
                    </div>
                    <pre className="mt-2 max-h-40 overflow-auto font-mono text-2xs text-fg-muted">
                      {generateMutation.data.content}
                    </pre>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </Section>

      <Section title="Workflow progress">
        <Card>
          <CardContent className="py-4">
            <ol className="flex flex-wrap gap-2">
              {PIPELINE_STEPS.map((step) => {
                const result = workflowMutation.data?.steps.find((s) => s.name === step);
                return (
                  <li
                    key={step}
                    className="flex items-center gap-1.5 rounded-sm border border-line bg-inset px-2.5 py-1.5"
                  >
                    <Badge variant={result ? STEP_STATUS_VARIANT[result.status] : 'neutral'}>
                      {result?.status ?? 'pending'}
                    </Badge>
                    <span className="font-mono text-2xs text-fg-muted">{step}</span>
                  </li>
                );
              })}
            </ol>
            {workflowMutation.data && (
              <p className="mt-3 text-2xs text-fg-subtle">
                Run {workflowMutation.data.id} — {workflowMutation.data.status}
              </p>
            )}
          </CardContent>
        </Card>
      </Section>

      <Section title="Generation logs">
        {history.isPending ? (
          <Skeleton className="h-48" />
        ) : history.isError ? (
          <Card className="border-danger/40">
            <CardContent className="flex items-start gap-3 py-4">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
              <p className="text-xs text-fg-muted">
                {history.error instanceof ApiClientError
                  ? history.error.message
                  : 'Unexpected error.'}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full min-w-[42rem] text-left text-xs">
              <thead>
                <tr className="border-b border-line font-mono text-2xs tracking-wide text-fg-subtle uppercase">
                  <th className="px-4 py-2.5 font-medium">Prompt</th>
                  <th className="px-4 py-2.5 font-medium">Provider / model</th>
                  <th className="px-4 py-2.5 font-medium">Tokens</th>
                  <th className="px-4 py-2.5 font-medium">Cost</th>
                  <th className="px-4 py-2.5 font-medium">Duration</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {history.data.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-2xs text-fg-subtle">
                      No generations yet — run a prompt template above.
                    </td>
                  </tr>
                )}
                {history.data.map((record) => (
                  <tr key={record.id}>
                    <td className="px-4 py-2.5 font-mono text-fg">{record.promptId}</td>
                    <td className="px-4 py-2.5 text-fg-muted">
                      {record.provider} · {record.model}
                    </td>
                    <td className="px-4 py-2.5 text-fg-muted tabular-nums">
                      {record.tokens.inputTokens + record.tokens.outputTokens}
                    </td>
                    <td className="px-4 py-2.5 text-fg-muted tabular-nums">
                      ${record.cost.totalCostUsd.toFixed(6)}
                    </td>
                    <td className="px-4 py-2.5 text-fg-muted tabular-nums">
                      {record.durationMs}ms
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        <Badge variant={STATUS_VARIANT[record.status]}>{record.status}</Badge>
                        {record.cacheHit && <Badge variant="accent">cached</Badge>}
                        {record.retries > 0 && <Badge variant="warning">{record.retries}r</Badge>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Cache & provider breakdown">
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5">
                <Database className="size-3.5" /> Cache statistics
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-xs text-fg-muted">
              <p>
                Entries cached:{' '}
                <span className="font-mono text-fg">{statistics.data?.cache.size ?? 0}</span>
              </p>
              <p>
                Hits: <span className="font-mono text-fg">{statistics.data?.cache.hits ?? 0}</span>
              </p>
              <p>
                Misses:{' '}
                <span className="font-mono text-fg">{statistics.data?.cache.misses ?? 0}</span>
              </p>
              <p>
                Hit rate:{' '}
                <span className="font-mono text-fg">{statistics.data?.cache.hitRate ?? 0}%</span>
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>By provider</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-xs text-fg-muted">
              {statistics.data && Object.keys(statistics.data.byProvider).length > 0 ? (
                Object.entries(statistics.data.byProvider).map(([provider, bucket]) => (
                  <p key={provider}>
                    <span className="font-mono text-fg">{provider}</span> — {bucket.generations}{' '}
                    generation(s), ${bucket.costUsd.toFixed(6)}
                  </p>
                ))
              ) : (
                <p>No generations yet.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </Section>
    </>
  );
}
