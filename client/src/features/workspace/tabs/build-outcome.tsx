/**
 * What a finished build actually amounts to.
 *
 * A run that reached the end reads 'completed' whether or not the result
 * works, so the sentence the server wrote about its outcome and the
 * capability-by-capability coverage have to be on screen beside it.
 * Coverage is judged from the project's files, and the wording says so: it
 * does not claim a feature was exercised at runtime.
 */
import { AlertTriangle, Check, X } from 'lucide-react';

import { Card, CardContent } from '@/shared/components/ui/card';
import type { FeatureImplementationResult, PipelineRun } from '@/shared/types/api';

const FEATURE_STATUS: Record<FeatureImplementationResult['status'], string> = {
  complete: 'Every requested capability has code behind it.',
  partial: 'Only part of what was requested was built.',
  failed: 'The requested features could not be built.',
  'not-run': 'No model was available to build the requested features.',
};

export function RunOutcomeNote({ run }: { run: PipelineRun }) {
  if (!run.outcome || run.outcome === 'verified' || !run.outcomeDetail) return null;
  return (
    <Card className="mt-3 border-warning/40">
      <CardContent className="flex items-start gap-3 py-4">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
        <p className="min-w-0 text-xs text-fg-muted">{run.outcomeDetail}</p>
      </CardContent>
    </Card>
  );
}

export function FeatureCoverage({ result }: { result: FeatureImplementationResult }) {
  const delivered = result.capabilities.filter((item) => item.status === 'implemented').length;
  return (
    <Card className="mt-3">
      <CardContent className="py-4">
        <p className="text-sm font-medium text-fg">
          Requested capabilities: {delivered} of {result.capabilities.length} have code behind them
        </p>
        <p className="mt-1 text-xs text-fg-muted">
          {FEATURE_STATUS[result.status]} Judged from the project&apos;s files, not by using the
          app.
        </p>
        <ul className="mt-3 space-y-2">
          {result.capabilities.map((item) => (
            <li key={item.id} className="flex items-start gap-2 text-xs">
              {item.status === 'implemented' ? (
                <Check className="mt-0.5 size-3.5 shrink-0 text-success" aria-label="Has code" />
              ) : (
                <X className="mt-0.5 size-3.5 shrink-0 text-danger" aria-label="Missing" />
              )}
              <div className="min-w-0">
                <p className="text-fg">{item.title}</p>
                {item.status === 'implemented' ? (
                  <p className="truncate font-mono text-2xs text-fg-subtle">
                    {item.files.join(', ')}
                  </p>
                ) : (
                  <p className="text-fg-muted">{item.gaps.join(' ')}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
        {result.limitations.length > 0 && (
          <ul className="mt-3 list-disc space-y-1 pl-4 text-2xs text-fg-subtle">
            {result.limitations.map((limit) => (
              <li key={limit}>{limit}</li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
