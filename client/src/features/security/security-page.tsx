import {
  AlertTriangle,
  CheckCircle2,
  FileArchive,
  GitBranch,
  KeyRound,
  Layers,
  ShieldCheck,
  ShieldAlert,
  UserCog,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { PageHeader } from '@/shared/components/page-header';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { EmptyState } from '@/shared/components/ui/empty-state';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { useDocumentTitle } from '@/shared/hooks/use-document-title';
import { cn } from '@/shared/lib/cn';
import { slugify } from '@/shared/lib/slugify';
import { downloadZip } from '@/shared/lib/zip';
import { ApiClientError } from '@/shared/services/api-client';
import { usePipelineStore } from '@/shared/store/pipeline.store';
import type {
  OwaspCategoryResult,
  OwaspStatus,
  SecurityBundle,
  SecurityFinding,
  SecuritySeverity,
} from '@/shared/types/api';
import { useSecurityBundle } from './use-security-bundle';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-sm font-medium text-fg">{title}</h2>
      {children}
    </section>
  );
}

const GRADE_COLOR: Record<SecurityBundle['report']['grade'], string> = {
  A: 'text-success',
  B: 'text-success',
  C: 'text-warning',
  D: 'text-warning',
  F: 'text-danger',
};

function ScoreCard({ report }: { report: SecurityBundle['report'] }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-5 py-5">
        <div
          className={cn('font-mono text-4xl font-semibold tabular-nums', GRADE_COLOR[report.grade])}
        >
          {report.grade}
        </div>
        <div>
          <p className="font-mono text-2xs tracking-widest text-fg-subtle uppercase">
            Overall security score
          </p>
          <p className="mt-1 text-2xl font-semibold text-fg tabular-nums">
            {report.overallScore}/100
          </p>
          <p className="mt-1 text-xs text-fg-muted">
            {report.summary.resolved} issue{report.summary.resolved === 1 ? '' : 's'} auto-resolved
            · {report.findings.length - report.summary.resolved} outstanding
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

const SEVERITY_VARIANT: Record<SecuritySeverity, 'danger' | 'warning' | 'accent' | 'neutral'> = {
  critical: 'danger',
  high: 'danger',
  medium: 'warning',
  low: 'neutral',
};

function SeverityStat({
  label,
  value,
  variant,
}: {
  label: string;
  value: number;
  variant: SecuritySeverity | 'resolved';
}) {
  return (
    <Card>
      <CardContent className="py-3">
        <p className="font-mono text-2xs tracking-widest text-fg-subtle uppercase">{label}</p>
        <p
          className={cn(
            'mt-1 text-xl font-semibold tabular-nums',
            variant === 'resolved'
              ? 'text-success'
              : variant === 'critical' || variant === 'high'
                ? 'text-danger'
                : variant === 'medium'
                  ? 'text-warning'
                  : 'text-fg',
          )}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

const OWASP_STATUS_VARIANT: Record<OwaspStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  pass: 'success',
  warn: 'warning',
  fail: 'danger',
  'not-applicable': 'neutral',
};

function OwaspGrid({ owasp }: { owasp: SecurityBundle['owasp'] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {owasp.categories.map((category: OwaspCategoryResult) => (
        <Card key={category.id}>
          <CardContent className="py-4">
            <div className="flex items-center justify-between gap-2">
              <p className="font-mono text-2xs text-fg-subtle">{category.id}</p>
              <Badge variant={OWASP_STATUS_VARIANT[category.status]}>{category.status}</Badge>
            </div>
            <p className="mt-1.5 text-xs font-medium text-fg">{category.title}</p>
            <p className="mt-1 text-2xs leading-relaxed text-fg-muted">{category.summary}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function FindingRow({ finding }: { finding: SecurityFinding }) {
  return (
    <li className="rounded-lg border border-line bg-surface px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={finding.resolved ? 'success' : SEVERITY_VARIANT[finding.severity]}>
          {finding.resolved ? 'resolved' : finding.severity}
        </Badge>
        <p className="text-xs font-medium text-fg">{finding.title}</p>
        {finding.owasp && (
          <span className="font-mono text-2xs text-fg-subtle">{finding.owasp.split(' - ')[0]}</span>
        )}
      </div>
      <p className="mt-1.5 text-2xs leading-relaxed text-fg-muted">{finding.description}</p>
      <p className="mt-1 text-2xs leading-relaxed text-fg-subtle">→ {finding.recommendation}</p>
    </li>
  );
}

function AuthOverview({ bundle }: { bundle: SecurityBundle }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          <KeyRound className="size-3.5" /> Authentication
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-xs text-fg-muted">
        <p>
          Identity table:{' '}
          <span className="font-mono text-fg">
            {bundle.stats.identityTableDetected ?? 'not detected'}
          </span>
        </p>
        <p>
          JWT: <span className="font-mono text-fg">{bundle.securityConfig.jwt.algorithm}</span>,
          access {bundle.securityConfig.jwt.accessTokenExpiresIn} / refresh{' '}
          {bundle.securityConfig.jwt.refreshTokenExpiresIn} (
          {bundle.securityConfig.jwt.refreshTokenStrategy})
        </p>
        <p>
          Password policy: {bundle.passwordPolicy.minLength}+ chars, upper/lower/number/symbol,
          bcrypt cost {bundle.passwordPolicy.bcryptSaltRounds}
        </p>
      </CardContent>
    </Card>
  );
}

function AuthzOverview({ bundle }: { bundle: SecurityBundle }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          <UserCog className="size-3.5" /> Authorization (RBAC)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex flex-wrap gap-1.5">
          {bundle.rbac.roles.map((role) => (
            <Badge key={role.role} variant="accent" title={role.description}>
              {role.role}
            </Badge>
          ))}
        </div>
        <p className="text-2xs text-fg-muted">
          {bundle.rbac.permissions.length} permission entries derived from entity-metadata.json
          across {new Set(bundle.rbac.permissions.map((p) => p.entity)).size} entities.
        </p>
      </CardContent>
    </Card>
  );
}

const TIMELINE_STAGES = [
  'Requirements analyzed',
  'Architecture planned',
  'Database designed',
  'Backend generated',
  'Frontend generated',
  'Security hardening applied',
] as const;

function SecurityTimeline({ generatedAt }: { generatedAt: string }) {
  return (
    <ol className="space-y-2">
      {TIMELINE_STAGES.map((stage, index) => (
        <li key={stage} className="flex items-center gap-3 text-xs">
          <CheckCircle2 className="size-3.5 shrink-0 text-success" />
          <span className="text-fg">{stage}</span>
          {index === TIMELINE_STAGES.length - 1 && (
            <span className="font-mono text-2xs text-fg-subtle">
              {new Date(generatedAt).toLocaleString()}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

export function SecurityPage() {
  useDocumentTitle('Security');
  const navigate = useNavigate();
  const architecture = usePipelineStore((state) => state.architecture);
  const security = useSecurityBundle();

  return (
    <>
      <PageHeader
        eyebrow="console/security"
        title="Security"
        description={
          security.data
            ? `Automated security audit and hardening for ${security.data.meta.projectName}.`
            : 'The Security Engine analyzes the generated project and injects enterprise-grade security automatically.'
        }
        actions={
          security.data ? (
            <Button
              variant="primary"
              icon={<FileArchive className="size-3.5" />}
              onClick={() => {
                const entries = [
                  ...security.data.backendFiles.map((f) => ({
                    path: `backend/${f.path}`,
                    content: f.content,
                  })),
                  ...security.data.frontendFiles.map((f) => ({
                    path: `frontend/${f.path}`,
                    content: f.content,
                  })),
                  {
                    path: 'security-report.json',
                    content: JSON.stringify(security.data.report, null, 2),
                  },
                ];
                downloadZip(
                  `${slugify(security.data.meta.projectName, 'security')}-security.zip`,
                  entries,
                );
              }}
            >
              Download security bundle
            </Button>
          ) : undefined
        }
      />

      {!architecture && (
        <EmptyState
          icon={<Layers className="size-4" />}
          title="No architecture plan yet"
          description="Plan the architecture first — the Security Engine analyzes the full design and generation pipeline."
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

      {architecture && (security.isPending || security.upstreamPending) && (
        <div className="space-y-3">
          <div className="grid gap-4 sm:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
          <Skeleton className="h-64" />
        </div>
      )}

      {architecture && security.isError && (
        <Card className="border-danger/40">
          <CardContent className="flex items-start gap-3 py-4">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
            <div>
              <p className="text-sm font-medium text-fg">Security analysis failed</p>
              <p className="mt-1 text-xs text-fg-muted">
                {security.error instanceof ApiClientError
                  ? security.error.message
                  : 'Unexpected error.'}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {security.data && (
        <>
          <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
            <ScoreCard report={security.data.report} />
            <div className="grid grid-cols-2 gap-3">
              <SeverityStat
                label="Critical"
                value={security.data.report.summary.critical}
                variant="critical"
              />
              <SeverityStat label="High" value={security.data.report.summary.high} variant="high" />
              <SeverityStat
                label="Medium"
                value={security.data.report.summary.medium}
                variant="medium"
              />
              <SeverityStat
                label="Resolved"
                value={security.data.report.summary.resolved}
                variant="resolved"
              />
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge variant="accent">
              <ShieldCheck className="mr-1 size-3" />
              OWASP {security.data.owasp.passed}/{security.data.owasp.categories.length} pass
            </Badge>
            <Badge variant="neutral">{security.data.stats.backendFiles} backend files</Badge>
            <Badge variant="neutral">{security.data.stats.frontendFiles} frontend files</Badge>
            <Badge variant="neutral">JWT + Refresh Tokens</Badge>
            <Badge variant="neutral">RBAC</Badge>
          </div>

          <Section title="Authentication & authorization overview">
            <div className="grid gap-4 sm:grid-cols-2">
              <AuthOverview bundle={security.data} />
              <AuthzOverview bundle={security.data} />
            </div>
          </Section>

          <Section title="OWASP Top 10 (2021)">
            <OwaspGrid owasp={security.data.owasp} />
          </Section>

          <Section
            title={`Detected risks — ${security.data.report.findings.length - security.data.report.summary.resolved} outstanding`}
          >
            {security.data.report.findings.filter((f) => !f.resolved).length === 0 ? (
              <Card>
                <CardContent className="flex items-center gap-2 py-4 text-xs text-fg-muted">
                  <ShieldCheck className="size-3.5 text-success" /> No outstanding findings.
                </CardContent>
              </Card>
            ) : (
              <ul className="space-y-2">
                {security.data.report.findings
                  .filter((f) => !f.resolved)
                  .map((finding) => (
                    <FindingRow key={finding.id} finding={finding} />
                  ))}
              </ul>
            )}
          </Section>

          {security.data.report.resolvedFindings.length > 0 && (
            <Section title={`Resolved issues — ${security.data.report.resolvedFindings.length}`}>
              <ul className="space-y-2">
                {security.data.report.resolvedFindings.map((finding) => (
                  <FindingRow key={finding.id} finding={finding} />
                ))}
              </ul>
            </Section>
          )}

          <Section title="Recommendations">
            {security.data.report.recommendations.length === 0 ? (
              <p className="text-xs text-fg-muted">Nothing outstanding to recommend.</p>
            ) : (
              <ul className="space-y-1.5">
                {security.data.report.recommendations.map((rec) => (
                  <li key={rec} className="flex items-start gap-2 text-xs text-fg-muted">
                    <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-fg-subtle" />
                    {rec}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Security timeline">
            <Card>
              <CardContent className="py-4">
                <SecurityTimeline generatedAt={security.data.meta.generatedAt} />
              </CardContent>
            </Card>
          </Section>

          <div className="mt-8 flex items-center justify-between gap-3 rounded-lg border border-line bg-surface px-5 py-4">
            <p className="text-xs text-fg-muted">
              This hardened project is the input for the Dependency Graph Engine — the next pipeline
              stage.
            </p>
            <Button
              variant="primary"
              icon={<GitBranch className="size-3.5" />}
              onClick={() => {
                void navigate('/dependency-graph');
              }}
            >
              Build dependency graph
            </Button>
          </div>
        </>
      )}
    </>
  );
}
