/** One build's research, laid out with its limits first. */
import { AlertTriangle } from 'lucide-react';

import { Badge } from '@/shared/components/ui/badge';
import type { ResearchArtifact, ResearchStatus } from '@/shared/types/research';
import { ResearchReferences } from './research-references';
import { hostOf } from './research-links';
import {
  ConfidenceBadge,
  PlainList,
  RetrievalBadge,
  SafeExternalLink,
  Section,
  SourceLinks,
} from './research-shared';
import { ResearchUsageSection } from './research-usage';

const STATUS_VARIANT = { complete: 'success', partial: 'warning', unavailable: 'danger' } as const;
const STATUS_LABEL: Record<ResearchStatus, string> = {
  complete: 'Complete',
  partial: 'Partial',
  unavailable: 'Found nothing usable',
};

const APPLIED_LABEL: Record<string, string> = {
  requirements: 'Requirements',
  'entity-fields': 'Data model fields',
  'site-design': 'Site design',
  'enhancement-plan': 'Enhancement plan',
};

function Limitations({ research }: { research: ResearchArtifact }) {
  if (research.limitations.length === 0 && research.status === 'complete') return null;
  return (
    <section
      aria-label="Research limitations"
      className="rounded-lg border border-warning/40 bg-surface px-5 py-4"
    >
      <h3 className="flex items-center gap-2 text-sm font-medium text-warning">
        <AlertTriangle aria-hidden="true" className="size-4" />
        What this research could not establish
      </h3>
      {research.status === 'unavailable' && (
        <p className="mt-2 text-xs leading-relaxed text-fg">
          Research ran but found nothing usable, so nothing in this build is backed by it.
        </p>
      )}
      {research.limitations.length > 0 ? (
        <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-relaxed text-fg-muted">
          {research.limitations.map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-fg-muted">The server recorded no further detail.</p>
      )}
    </section>
  );
}

function AppliedStages({ appliedTo }: { appliedTo: string[] | undefined }) {
  if (appliedTo === undefined) {
    return <p className="text-xs text-fg-subtle">Not recorded for this build.</p>;
  }
  if (appliedTo.length === 0) {
    return <p className="text-xs text-fg-subtle">No stage used this research.</p>;
  }
  return (
    <ul className="flex flex-wrap gap-2">
      {appliedTo.map((stage) => (
        <li key={stage}>
          <Badge variant="accent">{APPLIED_LABEL[stage] ?? stage}</Badge>
        </li>
      ))}
    </ul>
  );
}

function Sources({ research }: { research: ResearchArtifact }) {
  if (research.sources.length === 0) {
    return <p className="text-xs text-fg-subtle">No sources were retrieved.</p>;
  }
  return (
    <ul className="space-y-3">
      {research.sources.map((source) => (
        <li key={source.id} className="border-b border-line pb-3 last:border-0 last:pb-0">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <SafeExternalLink href={source.url}>
              {source.title || hostOf(source.url)}
            </SafeExternalLink>
            <RetrievalBadge kind={source.retrievalKind} />
          </div>
          <p className="mt-1 text-2xs text-fg-subtle">
            {hostOf(source.url)} via {source.provider}, read{' '}
            {new Date(source.accessedAt).toLocaleString()}
          </p>
          {source.flaggedLines.length > 0 && (
            <p className="mt-1 text-2xs text-warning">
              {source.flaggedLines.length} line(s) withheld because they read like instructions to
              an AI.
            </p>
          )}
          {source.excerpt && (
            <details className="mt-1">
              <summary className="cursor-pointer text-2xs text-fg-muted hover:text-fg">
                Excerpt
              </summary>
              <p className="mt-1 text-xs leading-relaxed whitespace-pre-wrap text-fg-muted">
                {source.excerpt}
              </p>
            </details>
          )}
        </li>
      ))}
    </ul>
  );
}

export function ResearchReport({
  research,
  appliedTo,
}: {
  research: ResearchArtifact;
  appliedTo: string[] | undefined;
}) {
  return (
    <div className="space-y-4">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={STATUS_VARIANT[research.status]}>{STATUS_LABEL[research.status]}</Badge>
          <Badge>{research.depth} depth</Badge>
          {research.domainLabel && <Badge>{research.domainLabel}</Badge>}
        </div>
        <h2 className="text-sm leading-relaxed text-fg">{research.objective}</h2>
        <p className="text-2xs text-fg-subtle">
          Gathered {new Date(research.generatedAt).toLocaleString()}
        </p>
      </header>

      <Limitations research={research} />

      <Section
        title="Used by"
        description="The build stages that really took this evidence as input."
      >
        <AppliedStages appliedTo={appliedTo} />
      </Section>

      <Section title="Visual direction" description="Model suggestion, not sourced.">
        <PlainList items={research.visualDirection} empty="No visual direction was derived." />
      </Section>

      <Section title="Findings">
        {research.findings.length === 0 ? (
          <p className="text-xs text-fg-subtle">No findings could be supported by a source.</p>
        ) : (
          <ul className="space-y-3">
            {research.findings.map((finding) => (
              <li key={finding.statement} className="space-y-1">
                <div className="flex flex-wrap items-start gap-2">
                  <p className="min-w-0 flex-1 text-xs leading-relaxed text-fg">
                    {finding.statement}
                  </p>
                  <ConfidenceBadge confidence={finding.confidence} />
                </div>
                <SourceLinks ids={finding.sourceIds} sources={research.sources} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Decisions">
        {research.decisions.length === 0 ? (
          <p className="text-xs text-fg-subtle">No decisions were drawn from this research.</p>
        ) : (
          <ul className="space-y-3">
            {research.decisions.map((decision) => (
              <li key={decision.decision} className="space-y-1">
                <div className="flex flex-wrap items-start gap-2">
                  <p className="min-w-0 flex-1 text-xs font-medium text-fg">{decision.decision}</p>
                  <ConfidenceBadge confidence={decision.confidence} />
                </div>
                <p className="text-xs leading-relaxed text-fg-muted">{decision.rationale}</p>
                <SourceLinks ids={decision.sourceIds} sources={research.sources} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Feature recommendations" description="Model suggestion, not sourced.">
          <PlainList items={research.featureRecommendations} empty="None recorded." />
        </Section>
        <Section title="UX patterns" description="Model suggestion, not sourced.">
          <PlainList
            items={[...research.uxPatterns, ...research.interactions]}
            empty="None recorded."
          />
        </Section>
        <Section
          title="Common patterns in this domain"
          description="Model suggestion, not sourced."
        >
          <PlainList items={research.commonPatterns} empty="None recorded." />
        </Section>
        <Section
          title="Implementation recommendations"
          description="Model suggestion, not sourced."
        >
          <PlainList items={research.implementationRecommendations} empty="None recorded." />
        </Section>
      </div>

      <Section
        title="Assets needed"
        description="Things a real version of this product needs supplied."
      >
        <PlainList items={research.assetRequirements} empty="None recorded." />
      </Section>

      <ResearchReferences references={research.referenceAnalyses} />

      <Section title={`Sources (${String(research.sources.length)})`}>
        <Sources research={research} />
      </Section>

      <ResearchUsageSection usage={research.usage} />
    </div>
  );
}
