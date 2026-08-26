import { AlertTriangle, Check, CircleDashed, Minus, Sparkles } from 'lucide-react';

import { Badge } from '@/shared/components/ui/badge';
import { Spinner } from '@/shared/components/ui/spinner';
import { cn } from '@/shared/lib/cn';
import type { PipelineStage } from '@/shared/types/api';

/**
 * Pipeline progress as it actually is: one row per stage, each showing the
 * server's real status. There is no percentage anywhere in this component
 * on purpose — a number nobody measures is worse than no number, because it
 * keeps moving while a stage is stuck.
 */
function StageIcon({ status }: { status: PipelineStage['status'] }) {
  switch (status) {
    case 'completed':
      return <Check className="size-3.5 text-success" />;
    case 'running':
      return <Spinner className="size-3.5" />;
    case 'failed':
      return <AlertTriangle className="size-3.5 text-danger" />;
    case 'skipped':
      return <Minus className="size-3.5 text-fg-subtle" />;
    default:
      return <CircleDashed className="size-3.5 text-fg-subtle" />;
  }
}

function duration(ms: number | null): string | null {
  if (ms === null) return null;
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export function StageList({ stages }: { stages: PipelineStage[] }) {
  return (
    <ol className="divide-y divide-line" aria-label="Pipeline stages">
      {stages.map((stage) => (
        <li
          key={stage.id}
          data-stage={stage.id}
          data-status={stage.status}
          className={cn(
            'flex items-start gap-3 px-5 py-3',
            stage.status === 'running' && 'bg-raised/40',
          )}
        >
          <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
            <StageIcon status={stage.status} />
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p
                className={cn(
                  'text-[0.8125rem] font-medium',
                  stage.status === 'pending' || stage.status === 'skipped'
                    ? 'text-fg-subtle'
                    : 'text-fg',
                )}
              >
                {stage.label}
              </p>
              {stage.engine === 'ai' && !stage.degraded && (
                <Badge variant="ember">
                  <span className="flex items-center gap-1">
                    <Sparkles className="size-2.5" /> AI
                  </span>
                </Badge>
              )}
              {stage.degraded && <Badge variant="warning">fallback</Badge>}
              {duration(stage.durationMs) && (
                <span className="font-mono text-2xs text-fg-subtle tabular-nums">
                  {duration(stage.durationMs)}
                </span>
              )}
            </div>

            {stage.summary && <p className="mt-0.5 text-xs text-fg-muted">{stage.summary}</p>}
            {stage.error && <p className="mt-0.5 text-xs text-danger">{stage.error}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
