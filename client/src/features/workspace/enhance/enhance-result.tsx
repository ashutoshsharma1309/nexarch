/**
 * Step four: what actually happened.
 *
 * The first line says whether this became the project. Each check keeps its
 * own status word, because a skipped or blocked step is not a pass, and the
 * step's command and exit code sit beside it so the claim can be checked.
 */
import { AlertTriangle, Check, CircleSlash, ExternalLink, Minus, Undo2, X } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/shared/components/ui/button';
import { Card, CardContent } from '@/shared/components/ui/card';
import { ConfirmDialog } from '@/shared/components/ui/confirm-dialog';
import { cn } from '@/shared/lib/cn';
import type {
  CoverageArea,
  EnhancementJob,
  EnhancementResult,
  FunctionalCheckResult,
  StoredVerificationStep,
} from '@/shared/services/enhancement.service';
import type { CheckStatus } from '@/shared/types/api';
import { CheckRow, Diff } from '../tabs/edit/edit-result';

const VERIFY_STATUS: Record<string, CheckStatus> = {
  passed: 'PASS',
  failed: 'FAIL',
  skipped: 'SKIPPED',
  blocked: 'BLOCKED',
};

/** An unknown status reads as blocked: never let it pass for a success. */
function toCheck(step: StoredVerificationStep): {
  name: string;
  status: CheckStatus;
  detail: string;
} {
  const facts = [
    step.command,
    step.exitCode === null ? null : `exit ${String(step.exitCode)}`,
    `${String(Math.round(step.durationMs / 1000))}s`,
  ].filter((fact): fact is string => fact !== null);
  return {
    name: step.id,
    status: VERIFY_STATUS[step.status] ?? 'BLOCKED',
    detail: [step.summary, step.reason, facts.join(' · ')]
      .filter((part): part is string => part !== null && part !== '')
      .join(' — '),
  };
}

function Heading({ children }: { children: string }) {
  return <p className="mb-1.5 text-2xs font-medium text-fg-subtle">{children}</p>;
}

function FunctionalCheck({ check }: { check: FunctionalCheckResult }) {
  return (
    <li className="px-4 py-2" data-functional={check.kind} data-passed={check.passed}>
      <p className="flex items-center gap-2 text-xs font-medium text-fg">
        {check.passed ? (
          <Check className="size-3.5 text-success" />
        ) : (
          <X className="size-3.5 text-danger" />
        )}
        {check.label}
      </p>
      <ul className="mt-1 ml-5 space-y-0.5">
        {check.steps.map((step) => (
          <li key={step.name} className="font-mono text-2xs break-all text-fg-muted">
            {step.passed ? 'ok' : 'failed'} · {step.method} {step.path} · expected {step.expected} ·
            got {step.actualStatus ?? 'no response'}
            {step.detail !== null && ` · ${step.detail}`}
          </li>
        ))}
      </ul>
      {check.limitations.map((limitation) => (
        <p key={limitation} className="mt-1 ml-5 text-xs text-warning">
          {limitation}
        </p>
      ))}
    </li>
  );
}

function CoverageList({ areas }: { areas: CoverageArea[] }) {
  return (
    <ul className="mt-1 space-y-1" aria-label="What the change had to touch">
      {areas.map((area) => (
        <li key={area.area} className="flex items-center gap-2 text-xs text-fg-muted">
          {area.alreadyPresent ? (
            <Minus className="size-3.5 text-fg-subtle" />
          ) : area.satisfied ? (
            <Check className="size-3.5 text-success" />
          ) : (
            <X className="size-3.5 text-danger" />
          )}
          {area.label}
          {area.alreadyPresent && (
            <span className="text-fg-subtle">Already present, unchanged</span>
          )}
        </li>
      ))}
    </ul>
  );
}

const HEADLINE: Record<EnhancementResult['status'], { text: string; tone: string }> = {
  applied: { text: 'Applied. This is the project now', tone: 'text-success' },
  rejected: { text: 'Rejected', tone: 'text-warning' },
  failed: { text: 'Failed', tone: 'text-danger' },
  cancelled: { text: 'Cancelled', tone: 'text-warning' },
};

/** Null means the provider did not report it; that is not the same as zero. */
function usageLine(usage: EnhancementResult['usage']): string {
  const known = (value: number | null): string => (value === null ? 'unknown' : String(value));
  const cost = usage.costUsd === null ? 'unknown' : `$${usage.costUsd.toFixed(4)}`;
  return `${String(usage.calls)} model calls · ${known(usage.inputTokens)} in · ${known(usage.outputTokens)} out · cost ${cost}`;
}

/** A job that ended with nothing to show but why. */
export function EnhanceJobOutcome({
  job,
  onDismiss,
}: {
  job: EnhancementJob;
  onDismiss: () => void;
}) {
  const interrupted = job.status === 'INTERRUPTED';
  const cancelled = job.status === 'CANCELLED';
  return (
    <div
      role="alert"
      className="rounded-md border border-line bg-inset p-4"
      data-status={job.status}
    >
      <p className="flex items-center gap-2 text-sm text-fg">
        <AlertTriangle
          className={cn(
            'size-3.5 shrink-0',
            interrupted || cancelled ? 'text-warning' : 'text-danger',
          )}
        />
        {cancelled
          ? 'This enhancement was cancelled'
          : interrupted
            ? 'This enhancement was interrupted'
            : 'This enhancement could not be applied'}
      </p>
      <p className="mt-2 text-xs leading-relaxed text-fg-muted">
        {job.error ?? 'The server did not say why.'}{' '}
        {interrupted
          ? 'What it reached cannot be told from here; check the Code tab for what the project holds.'
          : 'An enhancement only replaces the project once it has passed, so the project keeps the files it had before this started.'}
      </p>
      <p className="mt-2 text-2xs whitespace-pre-line text-fg-subtle">“{job.instruction}”</p>
      <button
        type="button"
        onClick={onDismiss}
        className="mt-3 text-xs text-accent underline underline-offset-2"
      >
        Start again
      </button>
    </div>
  );
}

export function EnhanceResult({
  job,
  result,
  reverting,
  revertError,
  restored,
  onRevert,
  onOpenPreview,
  onStartAnother,
}: {
  job: EnhancementJob;
  result: EnhancementResult;
  reverting: boolean;
  /** The server's refusal, verbatim, such as "no longer the latest version". */
  revertError: string | null;
  restored: { runId: string; restoredRunId: string } | null;
  onRevert: () => void;
  onOpenPreview: () => void;
  onStartAnother: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const applied = result.status === 'applied' && !result.rolledBack && result.runId !== null;
  // A revert is itself recorded as a job, and undoing one is not offered.
  const canRevert =
    applied && restored === null && job.status === 'SUCCEEDED' && !job.planId.startsWith('revert:');
  const headline = HEADLINE[result.status];
  const { verification } = result;

  return (
    <div className="space-y-4">
      <Card className={applied ? 'border-success/40' : 'border-warning/50'}>
        <CardContent className="py-3">
          <p className={cn('flex items-center gap-1.5 text-xs font-medium', headline.tone)}>
            {applied ? <Check className="size-3.5" /> : <Undo2 className="size-3.5" />}
            {headline.text}
            {!applied && result.rolledBack && '. Your project is unchanged'}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-fg">{result.outcome}</p>
          <p className="mt-1 font-mono text-2xs text-fg-subtle tabular-nums">
            {result.changedFiles.length} files changed · {result.unchangedFileCount} untouched
            {result.runId !== null && ` · run ${result.runId}`}
          </p>
          {restored !== null && (
            <p role="status" className="mt-1.5 text-xs leading-relaxed text-success">
              Reverted. The files from run {restored.restoredRunId} are back as a new version, run{' '}
              {restored.runId}. History is kept.
            </p>
          )}
        </CardContent>
      </Card>

      <div>
        <Heading>Validation · what ran on the changed project</Heading>
        <Card>
          {verification.ran && verification.steps.length > 0 ? (
            <ul className="divide-y divide-line" aria-label="Enhancement validation checks">
              {verification.steps.map((step) => (
                <CheckRow key={step.id} check={toCheck(step)} />
              ))}
            </ul>
          ) : (
            <p className="px-4 py-3 text-xs text-fg-muted">
              No validation ran, so nothing here has been checked.
            </p>
          )}
          {verification.failedRoutes.length > 0 && (
            <p className="border-t border-line px-4 py-2 font-mono text-2xs text-danger">
              routes that failed · {verification.failedRoutes.join(', ')}
            </p>
          )}
        </Card>
      </div>

      {result.functionalChecks.length > 0 && (
        <div>
          <Heading>Functional checks · driven over HTTP</Heading>
          <Card>
            <ul className="divide-y divide-line">
              {result.functionalChecks.map((check) => (
                <FunctionalCheck key={check.label} check={check} />
              ))}
            </ul>
          </Card>
        </div>
      )}

      {result.repair.attempted > 0 && (
        <p className="text-xs text-fg-muted">
          Repair ran {result.repair.attempted} time{result.repair.attempted === 1 ? '' : 's'} and{' '}
          {result.repair.repaired ? 'fixed the failure.' : 'did not fix the failure.'}
          {result.repair.initialFailures && result.repair.initialFailures.length > 0 && (
            <>
              {' '}
              Before repair:{' '}
              {result.repair.initialFailures.map((step) => `${step.id} ${step.status}`).join(', ')}.
            </>
          )}
        </p>
      )}

      {result.coverage.length > 0 && (
        <div>
          <Heading>Coverage · what this change had to touch</Heading>
          <CoverageList areas={result.coverage} />
        </div>
      )}

      <div>
        <Heading>{`The code this changed · ${String(result.changedFiles.length)} files`}</Heading>
        {result.changedFiles.length > 0 ? (
          <div className="space-y-2">
            {result.changedFiles.map((file) => (
              <Diff key={file.path} file={file} />
            ))}
          </div>
        ) : (
          <p className="flex items-center gap-1.5 text-xs text-fg-muted">
            <CircleSlash className="size-3.5 text-fg-subtle" />
            No file differed from the version already built.
          </p>
        )}
        {result.plannedButUnchanged.length > 0 && (
          <p className="mt-2 text-xs text-warning">
            Planned but never changed:{' '}
            <span className="font-mono text-2xs break-all">
              {result.plannedButUnchanged.join(', ')}
            </span>
          </p>
        )}
      </div>

      {result.limitations.length > 0 && (
        <div>
          <Heading>What this did not verify</Heading>
          <ul className="space-y-1">
            {result.limitations.map((limitation) => (
              <li key={limitation} className="text-xs leading-relaxed text-fg-muted">
                {limitation}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="font-mono text-2xs text-fg-subtle tabular-nums">{usageLine(result.usage)}</p>

      {revertError !== null && (
        <p role="alert" className="text-xs leading-relaxed text-danger">
          {revertError}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        {applied && (
          <Button
            variant="primary"
            icon={<ExternalLink className="size-3.5" />}
            onClick={onOpenPreview}
          >
            Open the updated app
          </Button>
        )}
        {canRevert && (
          <Button
            variant="secondary"
            loading={reverting}
            icon={<Undo2 className="size-3.5" />}
            onClick={() => {
              setConfirming(true);
            }}
          >
            Revert this change
          </Button>
        )}
        <Button variant="ghost" onClick={onStartAnother}>
          Make another change
        </Button>
      </div>

      <ConfirmDialog
        open={confirming}
        title="Revert this change?"
        description="This restores the files from before this enhancement as a new version. The current version stays in the project's history."
        confirmLabel="Revert"
        destructive
        loading={reverting}
        onCancel={() => {
          setConfirming(false);
        }}
        onConfirm={() => {
          setConfirming(false);
          onRevert();
        }}
      />
    </div>
  );
}
