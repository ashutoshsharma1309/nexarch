import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangle, Boxes, Hammer, MonitorPlay, RotateCcw, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';

import { publishArtifacts } from '@/features/pipeline/publish-artifacts';
import { StageList } from '@/features/pipeline/stage-list';
import { PageHeader } from '@/shared/components/page-header';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent, CardFooter } from '@/shared/components/ui/card';
import { Label } from '@/shared/components/ui/label';
import { Textarea } from '@/shared/components/ui/textarea';
import { useDocumentTitle } from '@/shared/hooks/use-document-title';
import {
  usePipelineArtifacts,
  usePipelineRun,
  useRetryRun,
  useStartRun,
} from '@/shared/hooks/use-pipeline';
import { cn } from '@/shared/lib/cn';
import { ApiClientError } from '@/shared/services/api-client';
import { toast } from '@/shared/store/toast.store';
import { HistoryList } from './components/history-list';
import { forgeDraftSchema, PROMPT_MAX_LENGTH } from './forge-schema';
import type { ForgeDraft } from './forge-schema';
import { useForgeStore } from './forge-store';

function ResultSummary({ runId }: { runId: string }) {
  const navigate = useNavigate();
  const run = usePipelineRun(runId);
  const artifacts = usePipelineArtifacts(run.data);

  if (!artifacts.data) return null;
  const { requirements, design, backend, frontend, security, files } = artifacts.data;

  const facts: { label: string; value: string }[] = [
    { label: 'Domain', value: requirements.projectType },
    { label: 'Entities', value: String(design.databaseDesign.tables.length) },
    { label: 'API routes', value: String(backend.routes.length) },
    { label: 'Pages', value: String(frontend.pages.length) },
    { label: 'Files', value: String(files.length) },
    { label: 'Security', value: `${security.report.grade} · ${security.report.overallScore}/100` },
  ];

  return (
    <Card className="mt-4">
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {facts.map((fact) => (
            <div key={fact.label}>
              <dt className="font-mono text-2xs tracking-widest text-fg-subtle uppercase">
                {fact.label}
              </dt>
              <dd className="mt-0.5 text-sm text-fg">{fact.value}</dd>
            </div>
          ))}
        </dl>

        <div className="flex flex-wrap gap-1.5">
          {requirements.modules.map((module) => (
            <Badge key={module} variant="neutral">
              {module}
            </Badge>
          ))}
        </div>
      </CardContent>
      <CardFooter className="justify-between">
        <p className="text-xs text-fg-muted">
          The project is generated. Preview runs it on localhost.
        </p>
        <div className="flex gap-2">
          <Button
            icon={<Boxes className="size-3.5" />}
            onClick={() => {
              void navigate('/architecture');
            }}
          >
            Inspect stages
          </Button>
          <Button
            variant="forge"
            icon={<MonitorPlay className="size-3.5" />}
            onClick={() => {
              void navigate(`/preview/${runId}`);
            }}
          >
            Open preview
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}

export function PromptPage() {
  useDocumentTitle('Forge');
  const { draft, saveDraft, addHistory } = useForgeStore();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [runId, setRunId] = useState<string | null>(null);

  const start = useStartRun();
  const retry = useRetryRun();
  const run = usePipelineRun(runId);
  const artifacts = usePipelineArtifacts(run.data);

  const form = useForm<ForgeDraft>({
    resolver: zodResolver(forgeDraftSchema),
    defaultValues: draft ?? { projectName: '', prompt: '' },
  });

  const promptValue = form.watch('prompt');
  const promptField = form.register('prompt');

  // Auto-growing editor: height tracks content up to a sane ceiling.
  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 480)}px`;
  }, [promptValue]);

  // A finished run's artifacts become the workspace's working set, so every
  // Explorer page reads this run instead of regenerating its own stage.
  useEffect(() => {
    if (!artifacts.data) return;
    publishArtifacts(artifacts.data);
    addHistory({
      prompt: run.data?.prompt ?? '',
      status: 'COMPLETE',
      projectType: artifacts.data.requirements.projectType,
    });
  }, [artifacts.data, run.data?.prompt, addHistory]);

  const focusPrompt = (): void => {
    textareaRef.current?.focus();
    textareaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const loadPrompt = (prompt: string): void => {
    form.setValue('prompt', prompt, { shouldValidate: true });
    focusPrompt();
  };

  const onSubmit = (values: ForgeDraft): void => {
    saveDraft(values);
    start.mutate(
      { prompt: values.prompt, ...(values.projectName ? { projectName: values.projectName } : {}) },
      {
        onSuccess: (created) => {
          setRunId(created.id);
        },
        onError: (error) => {
          toast(error instanceof Error ? error.message : 'Could not start the run', 'error');
        },
      },
    );
  };

  const active = run.data?.status === 'running' || start.isPending || retry.isPending;

  return (
    <>
      <PageHeader
        eyebrow="console/forge"
        title="Forge"
        description="Describe the application you want. NexArch analyzes, plans, generates, hardens and previews it."
      />

      <form
        onSubmit={(event) => {
          void form.handleSubmit(onSubmit)(event);
        }}
        noValidate
      >
        <Card>
          <div className="border-b border-line px-5 py-2.5">
            <p className="font-mono text-xs text-fg-subtle">
              <span className="text-ember">$</span> nexarch generate
            </p>
          </div>

          <CardContent className="space-y-2">
            <Label htmlFor="prompt">Application description</Label>
            <Textarea
              id="prompt"
              rows={5}
              maxLength={PROMPT_MAX_LENGTH}
              placeholder="An e-commerce platform with user authentication, product management, cart, orders and payment integration."
              invalid={Boolean(form.formState.errors.prompt)}
              className="min-h-28 resize-none"
              {...promptField}
              ref={(element) => {
                promptField.ref(element);
                textareaRef.current = element;
              }}
            />
            <div className="flex items-center justify-between">
              <p className="text-xs text-danger">{form.formState.errors.prompt?.message}</p>
              <p
                className={cn(
                  'font-mono text-2xs text-fg-subtle tabular-nums',
                  promptValue.length > PROMPT_MAX_LENGTH - 200 && 'text-warning',
                )}
              >
                {promptValue.length}/{PROMPT_MAX_LENGTH}
              </p>
            </div>
          </CardContent>

          <CardFooter className="justify-between">
            <p className="text-xs text-fg-muted">
              The more specific the description, the closer the schema.
            </p>
            <Button
              type="submit"
              variant="forge"
              size="lg"
              loading={active}
              icon={<Hammer className="size-4" />}
            >
              {active ? 'Generating…' : 'Generate project'}
            </Button>
          </CardFooter>
        </Card>
      </form>

      <section className="mt-4" aria-live="polite">
        {start.isError && (
          <Card className="border-danger/40">
            <CardContent className="flex items-start gap-3 py-4">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
              <div>
                <p className="text-sm font-medium text-fg">Could not start generation</p>
                <p className="mt-1 text-xs text-fg-muted">
                  {start.error instanceof ApiClientError
                    ? start.error.message
                    : 'Unexpected error — try again.'}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {run.data && (
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-2.5">
              <p className="font-mono text-xs text-fg-subtle">
                {run.data.projectName}
                <span className="mx-1.5 text-line-strong">/</span>
                {run.data.status}
              </p>
              {run.data.ai.calls > 0 && (
                <p className="flex items-center gap-1.5 font-mono text-2xs text-fg-subtle">
                  <Sparkles className="size-3 text-ember" />
                  {run.data.ai.model} · {run.data.ai.inputTokens + run.data.ai.outputTokens} tokens
                  · ${run.data.ai.estimatedCostUsd.toFixed(4)}
                </p>
              )}
            </div>

            <StageList stages={run.data.stages} />

            {run.data.status === 'failed' && (
              <CardFooter className="justify-between">
                <p className="flex items-start gap-2 text-xs text-danger">
                  <AlertTriangle className="mt-px size-3.5 shrink-0" />
                  {run.data.error ?? 'The run failed.'}
                </p>
                <Button
                  icon={<RotateCcw className="size-3.5" />}
                  loading={retry.isPending}
                  onClick={() => {
                    retry.mutate(run.data.id, {
                      onSuccess: (created) => {
                        setRunId(created.id);
                      },
                    });
                  }}
                >
                  Retry
                </Button>
              </CardFooter>
            )}
          </Card>
        )}

        {runId && run.data?.status === 'completed' && <ResultSummary runId={runId} />}
      </section>

      <HistoryList onSelect={loadPrompt} />
    </>
  );
}
