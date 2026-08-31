/**
 * Building this project: the prompt that starts a run, and the run's real
 * stage-by-stage state.
 *
 * This is the Forge, scoped. The prompt goes out with the project's name
 * attached, so the run the server creates joins *this* project instead of
 * spawning a sibling — which is what made the old top-level Forge sit
 * outside the project model entirely.
 *
 * Stages come straight from the server and each one links to the tab that
 * shows its output, so "Database Design · 9 tables" is a way in rather than
 * a status line. Completed stages link; pending ones do not, because there
 * is nothing behind them yet.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangle, ArrowRight, Hammer, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import { publishArtifacts } from '@/features/pipeline/publish-artifacts';
import { StageList } from '@/features/pipeline/stage-list';
import { AgentRunPanel } from './agent-run-panel';
import { PROMPT_MAX_LENGTH } from '@/features/prompt/forge-schema';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent, CardFooter } from '@/shared/components/ui/card';
import { Label } from '@/shared/components/ui/label';
import { Textarea } from '@/shared/components/ui/textarea';
import {
  usePipelineArtifacts,
  usePipelineRun,
  useRetryRun,
  useStartRun,
} from '@/shared/hooks/use-pipeline';
import { cn } from '@/shared/lib/cn';
import { PROMPT_EXAMPLES } from '@/shared/lib/prompt-examples';
import { toast } from '@/shared/store/toast.store';
import { z } from 'zod';
import { useWorkspace } from '../workspace-context';

const buildSchema = z.object({
  prompt: z
    .string()
    .trim()
    .min(20, 'Describe the application in at least 20 characters')
    .max(PROMPT_MAX_LENGTH),
});
type BuildValues = z.infer<typeof buildSchema>;

/** Which workspace tab shows a given stage's output. */
const STAGE_TAB: Record<string, string> = {
  analysis: 'requirements',
  architecture: 'architecture',
  database: 'database',
  backend: 'code',
  frontend: 'code',
  security: 'intelligence',
  dependencies: 'intelligence',
};

export function BuildTab() {
  const workspace = useWorkspace();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const base = `/projects/${workspace.project?.id ?? ''}`;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // A run started from this tab takes over from whatever the workspace
  // resolved, so the user watches the build they just triggered.
  const [startedRunId, setStartedRunId] = useState<string | null>(null);
  const start = useStartRun();
  const retry = useRetryRun();
  const started = usePipelineRun(startedRunId);
  const artifacts = usePipelineArtifacts(started.data);

  const liveRun = started.data ?? workspace.liveRun;

  const form = useForm<BuildValues>({
    resolver: zodResolver(buildSchema),
    defaultValues: { prompt: workspace.runs[0]?.prompt ?? '' },
  });
  const promptValue = form.watch('prompt');
  const promptField = form.register('prompt');

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 400)}px`;
  }, [promptValue]);

  // When the run this tab started finishes, publish its output and refresh
  // the project's run history so the rest of the workspace catches up.
  useEffect(() => {
    if (!artifacts.data) return;
    publishArtifacts(artifacts.data);
    void queryClient.invalidateQueries({ queryKey: ['project', workspace.project?.id, 'runs'] });
  }, [artifacts.data, queryClient, workspace.project?.id]);

  const onSubmit = (values: BuildValues): void => {
    start.mutate(
      { prompt: values.prompt, projectName: workspace.project?.name ?? '' },
      {
        onSuccess: (created) => {
          setStartedRunId(created.id);
          void queryClient.invalidateQueries({
            queryKey: ['project', workspace.project?.id, 'runs'],
          });
        },
        onError: (error) => {
          toast(error instanceof Error ? error.message : 'Could not start the build', 'error');
        },
      },
    );
  };

  const busy = start.isPending || retry.isPending || liveRun?.status === 'running';
  const failed = liveRun?.status === 'failed';

  return (
    <div className="space-y-6">
      <form
        onSubmit={(event) => {
          void form.handleSubmit(onSubmit)(event);
        }}
        noValidate
      >
        <Card>
          <div className="border-b border-line px-5 py-2.5">
            <p className="font-mono text-xs text-fg-subtle">
              <span className="text-ember">$</span> nexarch build {workspace.project?.slug}
            </p>
          </div>
          <CardContent className="space-y-2">
            <Label htmlFor="build-prompt">What should this project be?</Label>
            <Textarea
              id="build-prompt"
              rows={4}
              maxLength={PROMPT_MAX_LENGTH}
              placeholder="An e-commerce platform with user authentication, product management, cart, orders and payment integration."
              invalid={Boolean(form.formState.errors.prompt)}
              className="min-h-24 resize-none"
              disabled={busy}
              {...promptField}
              ref={(element) => {
                promptField.ref(element);
                textareaRef.current = element;
              }}
            />
            <div className="flex items-center justify-between">
              <p className="text-xs text-danger">{form.formState.errors.prompt?.message}</p>
              <p className="font-mono text-2xs text-fg-subtle tabular-nums">
                {promptValue.length}/{PROMPT_MAX_LENGTH}
              </p>
            </div>
            {promptValue.trim() === '' && (
              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                <span className="text-2xs text-fg-subtle">Try:</span>
                {PROMPT_EXAMPLES.map((example) => (
                  <button
                    key={example.label}
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      form.setValue('prompt', example.prompt, {
                        shouldValidate: true,
                        shouldDirty: true,
                      });
                      textareaRef.current?.focus();
                    }}
                    className="rounded-full border border-line px-2.5 py-1 text-2xs text-fg-muted transition-colors hover:border-line-strong hover:text-fg disabled:opacity-50"
                  >
                    {example.label}
                  </button>
                ))}
              </div>
            )}
          </CardContent>
          <CardFooter className="justify-between">
            <p className="text-xs text-fg-muted">
              The more specific the description, the closer the schema.
            </p>
            <Button
              type="submit"
              variant="forge"
              loading={busy}
              icon={<Hammer className="size-4" />}
            >
              {busy ? 'Building…' : workspace.latestRun ? 'Rebuild' : 'Build project'}
            </Button>
          </CardFooter>
        </Card>
      </form>

      {liveRun && (
        <section aria-label="Build progress" aria-live="polite">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-fg">
              {liveRun.status === 'running'
                ? 'Building'
                : liveRun.status === 'failed'
                  ? 'Build failed'
                  : 'Build complete'}
            </h2>
            {liveRun.ai.calls > 0 && (
              <p className="font-mono text-2xs text-fg-subtle">
                {liveRun.ai.model} · {liveRun.ai.inputTokens + liveRun.ai.outputTokens} tokens · $
                {liveRun.ai.estimatedCostUsd.toFixed(4)}
              </p>
            )}
          </div>

          <Card>
            <StageList stages={liveRun.stages} />
          </Card>

          {failed && (
            <Card className="mt-3 border-danger/40">
              <CardContent className="flex items-start gap-3 py-4">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-fg">This build didn’t finish</p>
                  <p className="mt-1 text-xs text-fg-muted">{liveRun.error}</p>
                  <Button
                    size="sm"
                    className="mt-3"
                    icon={<RotateCcw className="size-3.5" />}
                    loading={retry.isPending}
                    onClick={() => {
                      retry.mutate(liveRun.id, {
                        onSuccess: (created) => {
                          setStartedRunId(created.id);
                        },
                        onError: (error) => {
                          toast(error instanceof Error ? error.message : 'Retry failed', 'error');
                        },
                      });
                    }}
                  >
                    Retry build
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {liveRun.status === 'completed' && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <p className="text-xs text-fg-muted">Open what this build produced:</p>
              {liveRun.stages
                .filter((stage) => stage.status === 'completed' && STAGE_TAB[stage.id])
                .map((stage) => (
                  <Link
                    key={stage.id}
                    to={`${base}/${STAGE_TAB[stage.id]}`}
                    className={cn(
                      'rounded-md border border-line px-2 py-1 text-2xs text-fg-muted transition-colors',
                      'hover:border-line-strong hover:text-fg',
                      'focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none',
                    )}
                  >
                    {stage.label}
                  </Link>
                ))}
              <Button
                size="sm"
                variant="primary"
                icon={<ArrowRight className="size-3.5" />}
                onClick={() => {
                  void navigate(`${base}/preview`);
                }}
              >
                Preview
              </Button>
            </div>
          )}
        </section>
      )}

      {workspace.project && (
        <section aria-label="Agent runtime">
          <h2 className="mb-3 text-sm font-medium text-fg">Agent runtime</h2>
          <AgentRunPanel projectId={workspace.project.id} prompt={promptValue} />
        </section>
      )}

      {!liveRun && workspace.runs.length > 0 && (
        <section aria-label="Build history">
          <h2 className="mb-3 text-sm font-medium text-fg">Previous builds</h2>
          <Card>
            <ul className="divide-y divide-line">
              {workspace.runs.map((run) => (
                <li key={run.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <p className="min-w-0 truncate text-xs text-fg-muted">{run.prompt}</p>
                  <Badge
                    variant={
                      run.status === 'COMPLETED'
                        ? 'success'
                        : run.status === 'FAILED'
                          ? 'danger'
                          : 'ember'
                    }
                  >
                    {run.status}
                  </Badge>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}
    </div>
  );
}
