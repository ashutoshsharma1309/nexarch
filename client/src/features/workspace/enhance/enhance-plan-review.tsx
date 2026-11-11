/**
 * Step two: the plan, before anything has happened.
 *
 * The server marks a plan substantial when a person should read it first:
 * new or deleted files, several files, named risks, or a kind of change that
 * reaches beyond the screen. Those wait here for a decision. A small plan has
 * already been started by the time it is shown, so it says that instead of
 * offering a button that would only race the work.
 */
import { AlertTriangle, FileDiff, ListChecks, Search, ShieldQuestion, Trash2 } from 'lucide-react';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent } from '@/shared/components/ui/card';
import { ImpactSummary, SectionTitle } from '../tabs/edit/edit-plan-review';
import type { EnhancementPlan, PlannedFile } from '@/shared/services/enhancement.service';
import { kindLabel } from './enhance-model';

const ACTION_VARIANT: Record<PlannedFile['action'], 'success' | 'neutral' | 'warning'> = {
  create: 'success',
  modify: 'neutral',
  delete: 'warning',
};

const RESEARCH_HEADLINE: Record<EnhancementPlan['research']['outcome'], string> = {
  ran: 'Web research ran',
  skipped: 'Web research was skipped',
  'not-needed': 'No web research was needed',
};

function ResearchNote({ research }: { research: EnhancementPlan['research'] }) {
  return (
    <div className="rounded-md border border-line bg-inset px-3 py-2.5">
      <SectionTitle icon={<Search className="size-3" />}>
        {RESEARCH_HEADLINE[research.outcome]}
      </SectionTitle>
      <p className="mt-1 text-xs leading-relaxed text-fg-muted">{research.reason}</p>
      {research.outcome === 'ran' && (
        <p className="mt-1 font-mono text-2xs text-fg-subtle tabular-nums">
          {research.sourceCount} sources read · {research.findingCount} findings
        </p>
      )}
      {research.limitations.map((limitation) => (
        <p key={limitation} className="mt-1 text-xs leading-relaxed text-warning">
          {limitation}
        </p>
      ))}
    </div>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="mt-1.5 space-y-1">
      {items.map((item) => (
        <li key={item} className="text-xs leading-relaxed text-fg-muted">
          {item}
        </li>
      ))}
    </ul>
  );
}

export function EnhancePlanReview({
  plan,
  applying,
  error,
  onApprove,
  onDiscard,
}: {
  plan: EnhancementPlan;
  applying: boolean;
  error: string | null;
  onApprove: () => void;
  onDiscard: () => void;
}) {
  const waiting = plan.substantial;
  return (
    <div className="space-y-4">
      <Card className="border-accent/40">
        <CardContent className="py-3">
          <p className="flex items-center gap-1.5 text-xs font-medium text-accent">
            <ShieldQuestion className="size-3.5" />
            Nothing has changed yet
          </p>
          <p className="mt-1 text-xs leading-relaxed text-fg-muted">
            {waiting
              ? 'This is large enough to need your decision. The project keeps every file it has until you approve it.'
              : applying
                ? 'This is a small change, so it is starting now. It can be cancelled while it runs.'
                : 'This is a small change and it has not started.'}
          </p>
        </CardContent>
      </Card>

      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="neutral">{kindLabel(plan.kind)}</Badge>
          <span className="font-mono text-2xs text-fg-subtle">from run {plan.basedOnRunId}</span>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-fg">{plan.summary}</p>
        <p className="mt-1 text-xs whitespace-pre-line text-fg-muted italic">
          “{plan.instruction}”
        </p>
      </div>

      {plan.risks.length > 0 && (
        <Card className="border-warning/50">
          <CardContent className="py-3">
            <p className="flex items-center gap-1.5 text-xs font-medium text-warning">
              <AlertTriangle className="size-3.5" />
              {plan.risks.length === 1 ? 'One thing to decide first' : 'Things to decide first'}
            </p>
            <ul className="mt-2 space-y-1.5">
              {plan.risks.map((risk) => (
                <li key={risk} className="text-xs leading-relaxed text-fg">
                  {risk}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <ResearchNote research={plan.research} />
      <ImpactSummary impact={plan.impact} />

      <div>
        <SectionTitle icon={<FileDiff className="size-3" />}>
          Planned changes · {plan.files.length} files
        </SectionTitle>
        {plan.files.length > 0 ? (
          <ul className="mt-1.5 divide-y divide-line rounded-md border border-line">
            {plan.files.map((file) => (
              <li key={file.path} className="px-3 py-1.5">
                <p className="flex flex-wrap items-center gap-2">
                  <Badge variant={ACTION_VARIANT[file.action]}>{file.action}</Badge>
                  <span className="font-mono text-2xs break-all text-fg">{file.path}</span>
                </p>
                <p className="mt-0.5 text-2xs text-fg-subtle">{file.reason}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1.5 text-xs text-fg-muted">The plan names no file to change.</p>
        )}
      </div>

      {plan.steps.length > 0 && (
        <div>
          <SectionTitle icon={<ListChecks className="size-3" />}>Steps</SectionTitle>
          <ol className="mt-1.5 space-y-1">
            {plan.steps.map((step, index) => (
              <li key={step} className="flex gap-2 text-xs text-fg-muted">
                <span className="font-mono text-2xs text-fg-subtle tabular-nums">{index + 1}.</span>
                {step}
              </li>
            ))}
          </ol>
        </div>
      )}

      {plan.envChanges.length > 0 && (
        <div>
          <SectionTitle icon={<ShieldQuestion className="size-3" />}>
            New environment variables
          </SectionTitle>
          <ul className="mt-1.5 space-y-1">
            {plan.envChanges.map((change) => (
              <li key={change.name} className="text-xs text-fg-muted">
                <span className="font-mono text-2xs text-fg">{change.name}</span> {change.purpose}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <SectionTitle icon={<ListChecks className="size-3" />}>What will be checked</SectionTitle>
        <BulletList items={plan.validationPlan} />
      </div>

      {plan.limitations.length > 0 && (
        <div>
          <SectionTitle icon={<AlertTriangle className="size-3" />}>
            Limits of this plan
          </SectionTitle>
          <BulletList items={plan.limitations} />
        </div>
      )}

      {error !== null && (
        <div role="alert" className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-danger" />
          <p className="text-xs leading-relaxed text-danger">{error}</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <Button variant="forge" loading={applying} onClick={onApprove}>
          {waiting ? 'Approve and apply' : 'Start this change'}
        </Button>
        <Button
          variant="ghost"
          disabled={applying}
          icon={<Trash2 className="size-3.5" />}
          onClick={onDiscard}
        >
          Discard
        </Button>
        <p className="text-2xs text-fg-subtle">
          Discarding costs nothing; the plan is only a plan.
        </p>
      </div>
    </div>
  );
}
