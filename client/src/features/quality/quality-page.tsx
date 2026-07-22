import { useState } from 'react';
import {
  Award,
  BookOpen,
  Download,
  Gauge,
  Layers,
  Rocket,
  ShieldCheck,
  TestTube2,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { PageHeader } from '@/shared/components/page-header';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { EmptyState } from '@/shared/components/ui/empty-state';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { useAiStatistics } from '@/features/ai-orchestrator/use-ai-orchestrator';
import { useCurrentArtifacts } from '@/shared/hooks/use-current-artifacts';
import { useAnalyzeQuality, useExportQuality, useRunTesting } from '@/shared/hooks/use-quality';
import { useDocumentTitle } from '@/shared/hooks/use-document-title';
import { cn } from '@/shared/lib/cn';
import { downloadText } from '@/shared/lib/download';
import { slugify } from '@/shared/lib/slugify';
import { downloadZip } from '@/shared/lib/zip';
import { toast } from '@/shared/store/toast.store';
import type {
  CategoryScore,
  EngineeringGrade,
  QualityArtifacts,
  QualityExportFormat,
  ReadinessTier,
} from '@/shared/types/api';

const GRADE_VARIANT: Record<EngineeringGrade, 'success' | 'accent' | 'warning' | 'danger'> = {
  'A+': 'success',
  A: 'success',
  B: 'accent',
  C: 'warning',
  D: 'warning',
  F: 'danger',
};

const TIER_LABEL: Record<ReadinessTier, string> = {
  development: 'Development ready',
  testing: 'Testing ready',
  production: 'Production ready',
  enterprise: 'Enterprise ready',
};

const TIER_VARIANT: Record<ReadinessTier, 'neutral' | 'accent' | 'success'> = {
  development: 'neutral',
  testing: 'accent',
  production: 'success',
  enterprise: 'success',
};

const CATEGORY_LABEL: Record<CategoryScore['category'], string> = {
  architecture: 'Architecture',
  security: 'Security',
  performance: 'Performance',
  maintainability: 'Maintainability',
  scalability: 'Scalability',
  testing: 'Testing',
  documentation: 'Documentation',
  deployment: 'Deployment',
  developerExperience: 'Developer Experience',
};

const EXPORT_OPTIONS: { format: QualityExportFormat; label: string }[] = [
  { format: 'quality-report', label: 'quality-report.json' },
  { format: 'testing-report', label: 'testing-report.json' },
  { format: 'benchmark-report', label: 'benchmark-report.json' },
  { format: 'engineering-score', label: 'engineering-score.json' },
  { format: 'release-readiness', label: 'release-readiness.json' },
  { format: 'readme', label: 'README.md' },
  { format: 'documentation-package', label: 'Complete documentation package' },
];

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-fg">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  );
}

function CategoryCard({ category }: { category: CategoryScore }) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-fg">{CATEGORY_LABEL[category.category]}</p>
          <Badge variant={GRADE_VARIANT[category.grade]}>{category.grade}</Badge>
        </div>
        <p className="mt-1 text-xl font-semibold text-fg tabular-nums">{category.score}</p>
        {category.notes[0] && <p className="mt-1 text-2xs text-fg-muted">{category.notes[0]}</p>}
      </CardContent>
    </Card>
  );
}

export function QualityPage() {
  useDocumentTitle('Engineering Dashboard');
  const navigate = useNavigate();
  const { artifacts } = useCurrentArtifacts();
  const aiStatistics = useAiStatistics();
  const [deploymentConfigured, setDeploymentConfigured] = useState(false);

  const analyze = useAnalyzeQuality();
  const testing = useRunTesting();
  const exportMutation = useExportQuality();

  const bundle = analyze.data;

  const buildQualityArtifacts = (): QualityArtifacts | null => {
    if (!artifacts) return null;
    return {
      ...artifacts,
      aiStats: aiStatistics.data
        ? {
            totalGenerations: aiStatistics.data.totalGenerations,
            totalTokens: aiStatistics.data.totalTokens,
            totalCostUsd: aiStatistics.data.totalCostUsd,
            averageDurationMs: aiStatistics.data.averageDurationMs,
            cache: { hitRate: aiStatistics.data.cache.hitRate },
          }
        : undefined,
      deploymentConfigured,
    };
  };

  const handleAnalyze = (): void => {
    const qualityArtifacts = buildQualityArtifacts();
    if (!qualityArtifacts) return;
    analyze.mutate(qualityArtifacts, {
      onSuccess: (result) => {
        toast(`Engineering score: ${result.score.overall}/100 (${result.score.grade})`, 'success');
      },
      onError: () => {
        toast('Could not run the quality analysis', 'error');
      },
    });
    testing.mutate(qualityArtifacts);
  };

  const handleExport = (format: QualityExportFormat): void => {
    const qualityArtifacts = buildQualityArtifacts();
    if (!qualityArtifacts) return;
    exportMutation.mutate(
      { format, artifacts: qualityArtifacts },
      {
        onSuccess: (result) => {
          const slug = slugify(qualityArtifacts.projectName, 'project');
          if (result.kind === 'file') {
            downloadText(result.filename, result.content, result.mimeType);
          } else {
            downloadZip(`${slug}-${format}.zip`, result.files);
          }
          toast('Export ready — check your downloads', 'success');
        },
        onError: () => {
          toast('Export failed', 'error');
        },
      },
    );
  };

  return (
    <>
      <PageHeader
        eyebrow="console/quality"
        title="Engineering Dashboard"
        description="Testing, quality, performance, security, architecture, documentation, and release readiness for the current project."
      />

      {!artifacts ? (
        <EmptyState
          icon={<Gauge className="size-4" />}
          title="Nothing to analyze yet"
          description="Run the forge first — the engineering score is computed from the live pipeline."
          action={
            <Button
              variant="forge"
              onClick={() => {
                void navigate('/forge');
              }}
            >
              Open the forge
            </Button>
          }
        />
      ) : (
        <>
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
              <label className="flex items-center gap-2.5 text-xs text-fg-muted">
                <input
                  type="checkbox"
                  checked={deploymentConfigured}
                  onChange={(event) => {
                    setDeploymentConfigured(event.target.checked);
                  }}
                  className="size-3.5 rounded-sm border-line accent-accent"
                />
                I've configured deployment infrastructure for this project
              </label>
              <Button variant="forge" loading={analyze.isPending} onClick={handleAnalyze}>
                Run engineering analysis
              </Button>
            </CardContent>
          </Card>

          {analyze.isPending && (
            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              {Array.from({ length: 9 }, (_, i) => (
                <Skeleton key={i} className="h-20" />
              ))}
            </div>
          )}

          {bundle && (
            <>
              <Section title="Overall engineering score" icon={<Award className="size-4" />}>
                <Card>
                  <CardContent className="flex flex-wrap items-center justify-between gap-4 py-5">
                    <div>
                      <p className="text-3xl font-semibold text-fg tabular-nums">
                        {bundle.score.overall}/100
                      </p>
                      <p className="mt-1 text-xs text-fg-muted">{bundle.meta.projectName}</p>
                    </div>
                    <Badge variant={GRADE_VARIANT[bundle.score.grade]}>{bundle.score.grade}</Badge>
                    <Badge variant={TIER_VARIANT[bundle.readiness.tier]}>
                      {TIER_LABEL[bundle.readiness.tier]}
                    </Badge>
                  </CardContent>
                </Card>

                <div className="mt-4 grid gap-4 sm:grid-cols-3 xl:grid-cols-4">
                  {bundle.score.categories.map((category) => (
                    <CategoryCard key={category.category} category={category} />
                  ))}
                </div>
              </Section>

              <Section title="Testing" icon={<TestTube2 className="size-4" />}>
                <Card>
                  <CardContent className="space-y-3 py-4">
                    <p className="text-xs text-fg-muted">
                      Coverage estimate:{' '}
                      <span className="font-medium text-fg">
                        {bundle.testingCoverageEstimatePercent}%
                      </span>
                    </p>
                    <ul className="flex flex-wrap gap-2">
                      {bundle.testingSummary.map((s) => (
                        <li key={s.kind}>
                          <Badge variant="neutral">
                            {s.kind}: {s.fileCount} file{s.fileCount === 1 ? '' : 's'},{' '}
                            {s.caseCount} case
                            {s.caseCount === 1 ? '' : 's'}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                    {testing.data && (
                      <p className="text-2xs text-fg-subtle">
                        OpenAPI validation:{' '}
                        {testing.data.openApiValidation.valid
                          ? 'valid'
                          : `${testing.data.openApiValidation.issues.length} issue(s)`}{' '}
                        across {testing.data.openApiValidation.endpointsCovered} endpoint(s)
                      </p>
                    )}
                  </CardContent>
                </Card>
              </Section>

              <Section title="Quality issues" icon={<Layers className="size-4" />}>
                <Card>
                  {bundle.quality.issues.length === 0 ? (
                    <CardContent className="py-4">
                      <p className="text-xs text-fg-muted">No quality issues detected.</p>
                    </CardContent>
                  ) : (
                    <ul className="divide-y divide-line">
                      {bundle.quality.issues.slice(0, 12).map((issue, index) => (
                        <li key={index} className="flex items-center gap-3 px-5 py-2.5">
                          <Badge
                            variant={
                              issue.severity === 'critical' || issue.severity === 'high'
                                ? 'danger'
                                : issue.severity === 'medium'
                                  ? 'warning'
                                  : 'neutral'
                            }
                          >
                            {issue.severity}
                          </Badge>
                          <span className="w-32 shrink-0 truncate font-mono text-2xs text-fg-subtle">
                            {issue.category}
                          </span>
                          <p className="min-w-0 flex-1 truncate text-xs text-fg-muted">
                            {issue.message}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </Section>

              <Section title="Security & architecture" icon={<ShieldCheck className="size-4" />}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Card>
                    <CardHeader>
                      <CardTitle>Security checks</CardTitle>
                    </CardHeader>
                    <ul className="divide-y divide-line">
                      {bundle.security.checks.map((check) => (
                        <li key={check.name} className="flex items-center gap-3 px-5 py-2">
                          <Badge variant={check.passed ? 'success' : 'danger'}>
                            {check.passed ? 'pass' : 'fail'}
                          </Badge>
                          <p className="text-xs text-fg-muted">{check.name}</p>
                        </li>
                      ))}
                    </ul>
                  </Card>
                  <Card>
                    <CardHeader>
                      <CardTitle>Architecture checks</CardTitle>
                    </CardHeader>
                    <ul className="divide-y divide-line">
                      {bundle.architecture.checks.map((check) => (
                        <li key={check.name} className="flex items-center gap-3 px-5 py-2">
                          <Badge variant={check.passed ? 'success' : 'danger'}>
                            {check.passed ? 'pass' : 'fail'}
                          </Badge>
                          <p className="text-xs text-fg-muted">{check.name}</p>
                        </li>
                      ))}
                    </ul>
                  </Card>
                </div>
              </Section>

              <Section title="Release readiness" icon={<Rocket className="size-4" />}>
                <Card>
                  <CardContent className="py-4">
                    {bundle.readiness.recommendations.length === 0 ? (
                      <p className="text-xs text-fg-muted">
                        Every readiness check passes for this project's current tier.
                      </p>
                    ) : (
                      <ul className="space-y-1.5">
                        {bundle.readiness.recommendations.map((rec) => (
                          <li key={rec} className="text-xs text-fg-muted">
                            {rec}
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              </Section>

              <Section title="Documentation & export" icon={<BookOpen className="size-4" />}>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {EXPORT_OPTIONS.map((option) => {
                    const pending =
                      exportMutation.isPending && exportMutation.variables.format === option.format;
                    return (
                      <Card key={option.format}>
                        <CardContent className="flex items-center justify-between gap-3 py-4">
                          <p className={cn('text-xs text-fg-muted')}>{option.label}</p>
                          <Button
                            size="sm"
                            icon={<Download className="size-3.5" />}
                            loading={pending}
                            onClick={() => {
                              handleExport(option.format);
                            }}
                          >
                            Export
                          </Button>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </Section>
            </>
          )}
        </>
      )}
    </>
  );
}
