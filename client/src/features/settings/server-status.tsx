/**
 * The server's own health report, row by row.
 *
 * Every row is what `GET /health` returned. The AI provider row is deliberately
 * captioned: the server reports whether a provider is configured, which is not
 * the same as naming one or proving a call would succeed.
 */
import { Skeleton } from '@/shared/components/ui/skeleton';
import { StatusDot } from '@/shared/components/ui/status-dot';
import { useHealth } from '@/shared/hooks/use-health';
import { formatRelativeTime } from '@/shared/lib/format';
import type { DependencyCheck } from '@/shared/types/api';

const CHECKS: { key: string; label: string; note?: string }[] = [
  { key: 'database', label: 'Database' },
  {
    key: 'aiProvider',
    label: 'AI provider',
    note: 'Reports whether a provider is configured. It does not name the provider or test a call.',
  },
  { key: 'agentRuntime', label: 'Agent runtime' },
  { key: 'storage', label: 'Run storage' },
];

function uptime(seconds: number): string {
  if (seconds < 3600) return `${String(Math.floor(seconds / 60))}m`;
  if (seconds < 86_400) return `${String(Math.floor(seconds / 3600))}h`;
  return `${String(Math.floor(seconds / 86_400))}d`;
}

export function ServerStatus() {
  const health = useHealth();

  if (health.isPending) {
    return (
      <div className="space-y-2" aria-busy="true" aria-label="Checking the server">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    );
  }

  if (health.isError) {
    return (
      <p className="flex items-center gap-2 type-ui text-fg" role="status">
        <StatusDot tone="bad" />
        The server could not be reached, so its status is unknown.
      </p>
    );
  }

  const report = health.data;
  // Read by key because the rows below are declared as data.
  const checks: Partial<Record<string, DependencyCheck>> = report.checks;

  return (
    <div>
      <p className="mb-3 flex items-center gap-2 text-sm font-medium text-fg" role="status">
        <StatusDot tone={report.status === 'ok' ? 'ok' : 'warn'} />
        {report.status === 'ok' ? 'Operational' : 'Degraded'}
      </p>
      <ul className="divide-y divide-line border-y border-line">
        {CHECKS.map(({ key, label, note }) => {
          const check = checks[key];
          const message = check?.status === 'down' ? check.error : check?.detail;
          return (
            <li key={key} className="flex items-start gap-3 py-2.5">
              <StatusDot
                tone={!check ? 'neutral' : check.status === 'up' ? 'ok' : 'bad'}
                className="mt-1.5"
              />
              <div className="min-w-0 flex-1">
                <p className="type-ui font-medium text-fg">{label}</p>
                {message && <p className="mt-0.5 text-xs text-fg-muted">{message}</p>}
                {note && <p className="mt-0.5 text-xs text-fg-subtle">{note}</p>}
              </div>
              <span className="shrink-0 text-xs leading-5 text-fg-muted tabular-nums">
                {!check ? 'Not reported' : check.status === 'up' ? 'Up' : 'Down'}
                {check?.latencyMs !== undefined && ` · ${String(check.latencyMs)} ms`}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-fg-subtle">
        <span className="font-mono">v{report.version}</span> · {report.environment} · up{' '}
        {uptime(report.uptimeSeconds)} · checked {formatRelativeTime(report.timestamp)}
      </p>
    </div>
  );
}
