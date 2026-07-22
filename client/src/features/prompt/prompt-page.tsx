import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangle, DraftingCompass, Hammer, ScanSearch } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';

import { PageHeader } from '@/shared/components/page-header';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent, CardFooter } from '@/shared/components/ui/card';
import { Label } from '@/shared/components/ui/label';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { Textarea } from '@/shared/components/ui/textarea';
import { useDocumentTitle } from '@/shared/hooks/use-document-title';
import { cn } from '@/shared/lib/cn';
import { slugify } from '@/shared/lib/slugify';
import { ApiClientError } from '@/shared/services/api-client';
import type { AnalysisResult } from '@/shared/types/api';
import { HistoryList } from './components/history-list';
import { JsonViewer } from './components/json-viewer';
import { QuestionsCard } from './components/questions-card';
import { forgeDraftSchema, PROMPT_MAX_LENGTH } from './forge-schema';
import type { ForgeDraft } from './forge-schema';
import { useForgeStore } from './forge-store';
import { useAnalyze } from './use-analyze';

/** Pipeline stages in execution order. Analysis is live; the rest follow. */
const pipelineStages = [
  { name: 'Analyze', detail: 'Requirements are extracted into a structured spec', live: true },
  { name: 'Plan', detail: 'Architecture and database schema are designed', live: true },
  { name: 'Generate', detail: 'Backend and frontend code are produced', live: false },
  { name: 'Review', detail: 'Security is injected and the output is optimized', live: false },
] as const;

function AnalysisOutcome({ result, onRefine }: { result: AnalysisResult; onRefine: () => void }) {
  const navigate = useNavigate();

  if (result.status === 'INCOMPLETE') {
    return (
      <QuestionsCard
        questions={result.questions}
        projectType={result.detection.projectType}
        onRefine={onRefine}
      />
    );
  }

  const { spec, detection } = result;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="ember">{spec.projectType}</Badge>
        <Badge variant="neutral">confidence: {detection.confidence}</Badge>
        <Badge variant="neutral">{spec.modules.length} modules</Badge>
        {spec.missingRequirements.length > 0 && (
          <Badge variant="warning">
            {spec.missingRequirements.length} likely gap
            {spec.missingRequirements.length > 1 ? 's' : ''}
          </Badge>
        )}
      </div>
      <JsonViewer value={spec} exportName={slugify(spec.projectName, 'requirement-spec')} />
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-fg-muted">
          This specification is the input for the Architecture Planner — the next pipeline stage.
        </p>
        <Button
          variant="primary"
          icon={<DraftingCompass className="size-3.5" />}
          onClick={() => {
            void navigate('/architecture');
          }}
        >
          Plan architecture
        </Button>
      </div>
    </div>
  );
}

export function PromptPage() {
  useDocumentTitle('Forge');
  const { draft, saveDraft } = useForgeStore();
  const analyze = useAnalyze();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

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
    analyze.mutate(values.prompt);
  };

  return (
    <>
      <PageHeader
        eyebrow="console/forge"
        title="Forge"
        description="Describe the application you want. NexArch analyzes it into a structured specification."
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
              <span className="text-ember">$</span> nexarch analyze
            </p>
          </div>

          <CardContent className="space-y-2">
            <Label htmlFor="prompt">Application description</Label>
            <Textarea
              id="prompt"
              rows={5}
              maxLength={PROMPT_MAX_LENGTH}
              placeholder="An e-commerce site with JWT authentication, an admin dashboard, product management, and order tracking."
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
              Thin descriptions get clarifying questions, not guesses.
            </p>
            <Button
              type="submit"
              variant="forge"
              size="lg"
              loading={analyze.isPending}
              icon={<Hammer className="size-4" />}
            >
              {analyze.isPending ? 'Analyzing…' : 'Analyze requirements'}
            </Button>
          </CardFooter>
        </Card>
      </form>

      <section className="mt-4" aria-live="polite">
        {analyze.isPending && (
          <Card>
            <CardContent className="space-y-2.5 py-4">
              <div className="flex items-center gap-2 text-xs text-fg-muted">
                <ScanSearch className="size-3.5 animate-pulse text-ember" />
                Extracting intent, roles, modules and integrations…
              </div>
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-3 w-2/3" />
            </CardContent>
          </Card>
        )}

        {analyze.isError && (
          <Card className="border-danger/40">
            <CardContent className="flex items-start gap-3 py-4">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
              <div>
                <p className="text-sm font-medium text-fg">Analysis failed</p>
                <p className="mt-1 text-xs text-fg-muted">
                  {analyze.error instanceof ApiClientError
                    ? analyze.error.message
                    : 'Unexpected error — try again.'}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {analyze.data && <AnalysisOutcome result={analyze.data} onRefine={focusPrompt} />}
      </section>

      <HistoryList onSelect={loadPrompt} />

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-medium text-fg">The pipeline</h2>
        <ol className="grid gap-2 sm:grid-cols-2">
          {pipelineStages.map((stage, index) => (
            <li
              key={stage.name}
              className="flex gap-3 rounded-lg border border-line bg-surface px-4 py-3"
            >
              <span className="font-mono text-xs text-fg-subtle">0{index + 1}</span>
              <div>
                <p className="flex items-center gap-2 text-[0.8125rem] font-medium text-fg">
                  {stage.name}
                  {stage.live ? (
                    <Badge variant="ember">live</Badge>
                  ) : (
                    <Badge variant="neutral">phase 2</Badge>
                  )}
                </p>
                <p className="mt-0.5 text-xs text-fg-muted">{stage.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
