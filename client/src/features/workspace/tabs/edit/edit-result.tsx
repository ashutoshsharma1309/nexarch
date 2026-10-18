/**
 * Step four of an edit: what actually happened.
 *
 * An edit either became the project's newest version or it did not, and the
 * first line says which. A discarded edit is the more important of the two to
 * get right: the build failed *and* the project is untouched, which is good
 * news wearing the costume of bad news, so it is stated in those words.
 *
 * Each check keeps the validator's own status word next to its icon. SKIPPED
 * is not a pass and must never be able to pass for one — a project with no
 * lint script did not pass lint, it never ran it — so every status is written
 * out in text, with its own tone and its own icon, and the detail line below
 * carries the command and exit code it came from.
 */
import { Ban, Check, CircleSlash, ExternalLink, Minus, Undo2, X } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import { Card, CardContent } from '@/shared/components/ui/card';
import { cn } from '@/shared/lib/cn';
import { DesignComparison } from './design-comparison';
import type {
  CheckStatus,
  EditChangedFile,
  EditPlan,
  EditResult,
  SiteDesignView,
} from '@/shared/types/api';

/** One tone, one icon and one word per status — no status shares a look. */
const CHECK_PRESENTATION: Record<
  CheckStatus,
  { word: string; tone: string; icon: typeof Check; note: string }
> = {
  PASS: { word: 'passed', tone: 'text-success', icon: Check, note: 'ran and succeeded' },
  FAIL: { word: 'failed', tone: 'text-danger', icon: X, note: 'ran and failed' },
  SKIPPED: {
    word: 'skipped',
    tone: 'text-fg-subtle',
    icon: Minus,
    note: 'never ran — this is not a pass',
  },
  BLOCKED: {
    word: 'blocked',
    tone: 'text-warning',
    icon: Ban,
    note: 'could not run',
  },
};

function CheckRow({ check }: { check: EditResult['validation']['checks'][number] }) {
  const presentation = CHECK_PRESENTATION[check.status];
  const Icon = presentation.icon;
  return (
    <li className="px-4 py-2" data-check={check.name} data-status={check.status}>
      <div className="flex flex-wrap items-center gap-2">
        <Icon className={cn('size-3.5 shrink-0', presentation.tone)} />
        <span className="text-xs font-medium text-fg">{check.name}</span>
        <span className={cn('font-mono text-2xs tracking-wide uppercase', presentation.tone)}>
          {presentation.word}
        </span>
        <span className="text-2xs text-fg-subtle">{presentation.note}</span>
      </div>
      <p className="mt-0.5 ml-5 font-mono text-2xs break-all text-fg-muted">{check.detail}</p>
    </li>
  );
}

/**
 * A readable hunk diff — removed lines, then added, never whole files. The
 * same shape Self-Repair uses, so a changed file reads the same wherever the
 * console shows one.
 */
function Diff({ file }: { file: EditChangedFile }) {
  return (
    <div className="overflow-x-auto rounded border border-line bg-raised/40">
      <p className="border-b border-line px-2 py-1 font-mono text-2xs text-fg-subtle">
        {file.path} <span className="text-success">+{file.addedLines}</span>{' '}
        <span className="text-danger">−{file.removedLines}</span>
      </p>
      <pre className="p-2 text-2xs leading-relaxed">
        {file.hunks.map((hunk, index) => (
          <span key={`${String(hunk.line)}-${String(index)}`}>
            <span className="text-fg-subtle">
              @@ line {hunk.line} @@{'\n'}
            </span>
            {hunk.removed.map((line, i) => (
              <span key={`r${String(i)}`} className="text-danger">
                − {line}
                {'\n'}
              </span>
            ))}
            {hunk.added.map((line, i) => (
              <span key={`a${String(i)}`} className="text-success">
                + {line}
                {'\n'}
              </span>
            ))}
          </span>
        ))}
      </pre>
    </div>
  );
}

export function EditResultView({
  plan,
  result,
  currentDesign,
  designUnavailableReason,
  onOpenPreview,
  onStartAnother,
}: {
  plan: EditPlan;
  result: EditResult;
  /** The design the project had before this edit, when it is still loaded. */
  currentDesign: SiteDesignView | null;
  designUnavailableReason: string;
  onOpenPreview: () => void;
  onStartAnother: () => void;
}) {
  const applied = !result.rolledBack && result.runId !== null;

  return (
    <div className="space-y-4">
      <Card className={applied ? 'border-success/40' : 'border-warning/50'}>
        <CardContent className="py-3">
          <p
            className={cn(
              'flex items-center gap-1.5 text-xs font-medium',
              applied ? 'text-success' : 'text-warning',
            )}
          >
            {applied ? <Check className="size-3.5" /> : <Undo2 className="size-3.5" />}
            {applied
              ? 'Applied — this is the project now'
              : 'Discarded — your project is unchanged'}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-fg">{result.outcome}</p>
          <p className="mt-1 font-mono text-2xs text-fg-subtle tabular-nums">
            status {result.status} · {result.changedFiles.length} files changed ·{' '}
            {result.unchangedFileCount} untouched
            {result.runId !== null && ` · recorded as run ${result.runId}`}
          </p>
          {!applied && (
            <p className="mt-1.5 text-xs leading-relaxed text-fg-muted">
              Nothing was written. Every file is exactly as it was before you applied this edit, so
              there is nothing to undo.
            </p>
          )}
        </CardContent>
      </Card>

      <div>
        <p className="mb-1.5 font-mono text-2xs tracking-wide text-fg-subtle uppercase">
          Validation · what ran on the edited project
        </p>
        <Card>
          {result.validation.checks.length > 0 ? (
            <ul className="divide-y divide-line" aria-label="Edit validation checks">
              {result.validation.checks.map((check) => (
                <CheckRow key={check.name} check={check} />
              ))}
            </ul>
          ) : (
            <p className="px-4 py-3 text-xs text-fg-muted">
              The validator reported no checks at all, which means none of them ran.
            </p>
          )}
          <p className="border-t border-line px-4 py-2 font-mono text-2xs text-fg-subtle">
            {result.validation.startedUp
              ? 'the edited app started and answered'
              : 'the edited app did not start'}
            {result.validation.frontendUrl !== null &&
              ` · frontend ${result.validation.frontendUrl}`}
            {result.validation.backendUrl !== null && ` · backend ${result.validation.backendUrl}`}
          </p>
        </Card>
      </div>

      <div>
        <p className="mb-1.5 font-mono text-2xs tracking-wide text-fg-subtle uppercase">
          Design comparison · decisions before and after
        </p>
        <DesignComparison
          before={currentDesign}
          after={plan.design}
          unavailableReason={designUnavailableReason}
        />
      </div>

      <div>
        <p className="mb-1.5 font-mono text-2xs tracking-wide text-fg-subtle uppercase">
          The code this edit wrote · {result.changedFiles.length} files
        </p>
        {result.changedFiles.length > 0 ? (
          <div className="space-y-2">
            {result.changedFiles.map((file) => (
              <Diff key={file.path} file={file} />
            ))}
          </div>
        ) : (
          <p className="flex items-center gap-1.5 text-xs text-fg-muted">
            <CircleSlash className="size-3.5 text-fg-subtle" />
            No file differed from the version that was already built.
          </p>
        )}
      </div>

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
        <Button variant="ghost" onClick={onStartAnother}>
          Make another edit
        </Button>
      </div>
    </div>
  );
}
