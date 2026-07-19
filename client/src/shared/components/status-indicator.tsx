import { useHealth } from '@/shared/hooks/use-health';
import { cn } from '@/shared/lib/cn';

type ApiState = 'operational' | 'degraded' | 'offline' | 'checking';

function resolveState(health: ReturnType<typeof useHealth>): ApiState {
  if (health.isPending) return 'checking';
  if (health.isError) return 'offline';
  return health.data.status === 'ok' ? 'operational' : 'degraded';
}

const stateStyles: Record<ApiState, { dot: string; label: string }> = {
  operational: { dot: 'bg-success', label: 'API operational' },
  degraded: { dot: 'bg-warning', label: 'API degraded' },
  offline: { dot: 'bg-danger', label: 'API offline' },
  checking: { dot: 'bg-fg-subtle', label: 'Checking API' },
};

/** Live API health, polled every 30s — a dev tool should always show its own vitals. */
export function StatusIndicator() {
  const health = useHealth();
  const state = resolveState(health);
  const { dot, label } = stateStyles[state];

  return (
    <div
      className="flex items-center gap-2 rounded-md border border-line px-2.5 py-1"
      role="status"
      title={
        health.data
          ? `v${health.data.version} · db ${health.data.checks.database.status}`
          : undefined
      }
    >
      <span className={cn('size-1.5 rounded-full', dot)} aria-hidden="true" />
      <span className="font-mono text-2xs text-fg-muted">{label}</span>
    </div>
  );
}
