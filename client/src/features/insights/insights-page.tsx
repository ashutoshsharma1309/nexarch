import { BrainCircuit, FileQuestion, Gauge, GitCompareArrows, ScrollText } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { CodeViewer } from '@/features/database/components/code-viewer';
import { PageHeader } from '@/shared/components/page-header';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { EmptyState } from '@/shared/components/ui/empty-state';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { useDocumentTitle } from '@/shared/hooks/use-document-title';
import { useInsights } from '@/shared/hooks/use-insights';
import { cn } from '@/shared/lib/cn';
import type { InsightScore, InsightsDiagram, TechnologyJustification } from '@/shared/types/api';

const GRADE_VARIANT: Record<InsightScore['grade'], 'success' | 'accent' | 'warning' | 'danger'> = {
  'A+': 'success',
  A: 'success',
  B: 'accent',
  C: 'warning',
  D: 'warning',
  F: 'danger',
};

function ScoreCard({ label, score }: { label: string; score: InsightScore }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          {label}
          <Badge variant={GRADE_VARIANT[score.grade]}>{score.grade}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="font-mono text-2xl font-semibold text-fg">
          {score.score}
          <span className="text-sm text-fg-subtle">/100</span>
        </p>
        <ul className="mt-2 space-y-1">
          {score.reasoning.map((line) => (
            <li key={line} className="text-xs leading-relaxed text-fg-muted">
              {line}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function Markdown({ text }: { text: string }) {
  return (
    <pre className="font-sans text-[0.8125rem] leading-relaxed whitespace-pre-wrap text-fg-muted">
      {text}
    </pre>
  );
}

function Diagram({ diagram, filename }: { diagram: InsightsDiagram; filename: string }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-fg">{diagram.title}</p>
        <p className="text-2xs text-fg-subtle">
          Mermaid source — renders on mermaid.live or GitHub
        </p>
      </div>
      <CodeViewer code={diagram.mermaid} filename={filename} mime="text/plain" language="mermaid" />
    </div>
  );
}

function Justification({ item }: { item: TechnologyJustification }) {
  return (
    <div className="rounded-md border border-line bg-raised/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-fg">{item.question}</p>
        <Badge variant="neutral">{item.technology}</Badge>
      </div>
      <p className="mt-2 text-[0.8125rem] leading-relaxed text-fg-muted">{item.reasoning}</p>
      {item.alternatives.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-line pt-2">
          {item.alternatives.map((alternative) => (
            <li key={alternative.option} className="text-xs text-fg-subtle">
              <span className="text-fg-muted">{alternative.option}</span> — rejected:{' '}
              {alternative.rejectedBecause}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function InsightsPage() {
  useDocumentTitle('Insights');
  const navigate = useNavigate();
  const insights = useInsights();

  if (!insights.isFetching && !insights.data && !insights.isError) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="console/insights"
          title="Insights"
          description="Automatic architecture analysis of the current pipeline"
        />
        <EmptyState
          icon={<FileQuestion className="size-4" />}
          title="Nothing to analyze yet"
          description="Run a prompt through the Forge — insights generate automatically once requirements, architecture and database design exist."
          action={
            <Button
              onClick={() => {
                void navigate('/forge');
              }}
            >
              Open the Forge
            </Button>
          }
        />
      </div>
    );
  }

  if (insights.isError) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="console/insights"
          title="Insights"
          description="Automatic architecture analysis of the current pipeline"
        />
        <EmptyState
          icon={<FileQuestion className="size-4" />}
          title="Analysis failed"
          description={insights.error instanceof Error ? insights.error.message : 'Unknown error'}
          action={
            <Button
              onClick={() => {
                void insights.refetch();
              }}
            >
              Retry
            </Button>
          }
        />
      </div>
    );
  }

  const bundle = insights.data;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="console/insights"
        title="Insights"
        description={
          bundle
            ? `${bundle.meta.projectName} — generated ${new Date(bundle.meta.generatedAt).toLocaleString()}`
            : 'Analyzing the current pipeline…'
        }
      />

      {!bundle ? (
        <div className="grid gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-40" />
          ))}
        </div>
      ) : (
        <>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" aria-label="Scores">
            <ScoreCard label="Overall" score={bundle.scores.overall} />
            <ScoreCard label="Maintainability" score={bundle.scores.maintainability} />
            <ScoreCard label="Security" score={bundle.scores.security} />
            <ScoreCard label="Scalability" score={bundle.scores.scalability} />
          </section>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <ScrollText className="size-4" /> Architecture summary
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Markdown text={bundle.summary} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <BrainCircuit className="size-4" /> Why this stack?
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {bundle.technologyJustifications.map((item) => (
                <Justification key={item.question} item={item} />
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <GitCompareArrows className="size-4" /> Diagrams
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <Diagram diagram={bundle.diagrams.architecture} filename="architecture.mmd" />
              <Diagram diagram={bundle.diagrams.er} filename="er-diagram.mmd" />
              <Diagram diagram={bundle.diagrams.apiFlow} filename="api-flow.mmd" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Gauge className="size-4" /> Deep dives
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-6 lg:grid-cols-2">
              {(
                [
                  ['Folders', bundle.explanations.folders],
                  ['Database', bundle.explanations.database],
                  ['API', bundle.explanations.api],
                  ['Security', bundle.explanations.security],
                ] as const
              ).map(([label, text]) => (
                <div key={label} className={cn('rounded-md border border-line bg-raised/40 p-4')}>
                  <p className="mb-2 text-sm font-semibold text-fg">{label}</p>
                  <div className="max-h-80 overflow-y-auto">
                    <Markdown text={text} />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
