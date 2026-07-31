/**
 * One-click deploy execution (Phase 13). Providers come from the server
 * registry — nothing here names a vendor. Unconfigured providers render
 * with their exact enable requirements instead of disappearing, and an
 * in-flight execution shows the real state machine (queued → building →
 * deploying → monitoring → live | failed) by polling the execution record.
 */
import { useState } from 'react';
import { CheckCircle2, ExternalLink, KeyRound, Rocket, XCircle } from 'lucide-react';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { Spinner } from '@/shared/components/ui/spinner';
import {
  useDeployExecution,
  useDeployProviders,
  useExecuteDeploy,
} from '@/shared/hooks/use-deployment';
import { cn } from '@/shared/lib/cn';
import { toast } from '@/shared/store/toast.store';
import type { DeployExecutionPhase, DeployProviderId, ProjectArtifacts } from '@/shared/types/api';

const PHASE_VARIANT: Record<
  DeployExecutionPhase,
  'success' | 'accent' | 'warning' | 'danger' | 'neutral'
> = {
  queued: 'neutral',
  building: 'accent',
  deploying: 'accent',
  monitoring: 'accent',
  live: 'success',
  failed: 'danger',
};

function executionFiles(artifacts: ProjectArtifacts): { path: string; content: string }[] {
  return [
    ...(artifacts.backend?.files ?? []).map((f) => ({
      path: `backend/${f.path}`,
      content: f.content ?? '',
    })),
    ...(artifacts.frontend?.files ?? []).map((f) => ({
      path: `frontend/${f.path}`,
      content: f.content ?? '',
    })),
  ];
}

export function LaunchSection({ artifacts }: { artifacts: ProjectArtifacts }) {
  const providers = useDeployProviders();
  const execute = useExecuteDeploy();
  const [executionId, setExecutionId] = useState<string | null>(null);
  const execution = useDeployExecution(executionId);

  const files = executionFiles(artifacts);

  const launch = (provider: DeployProviderId) => {
    execute.mutate(
      { provider, projectName: artifacts.projectName, files },
      {
        onSuccess: (record) => {
          setExecutionId(record.id);
          toast('Deployment started', 'success');
        },
        onError: (error) => {
          toast(error.message, 'error');
        },
      },
    );
  };

  return (
    <div className="space-y-4">
      {providers.isPending ? (
        <Skeleton className="h-32" />
      ) : (
        <div className="grid gap-4 sm:grid-cols-3">
          {(providers.data ?? []).map((provider) => (
            <Card key={provider.id} className={cn(!provider.configured && 'opacity-80')}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  {provider.name}
                  {provider.configured ? (
                    <Badge variant="success">ready</Badge>
                  ) : (
                    <Badge variant="neutral">disabled</Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <p className="text-xs leading-relaxed text-fg-muted">{provider.strategy}</p>
                {provider.configured ? (
                  <Button
                    size="sm"
                    icon={<Rocket className="size-3.5" />}
                    loading={execute.isPending && execute.variables.provider === provider.id}
                    disabled={files.length === 0}
                    onClick={() => {
                      launch(provider.id);
                    }}
                  >
                    Deploy
                  </Button>
                ) : (
                  <div className="flex items-start gap-2 rounded-md border border-line bg-raised/40 p-2.5">
                    <KeyRound className="mt-0.5 size-3.5 shrink-0 text-fg-subtle" />
                    <p className="text-2xs leading-relaxed text-fg-subtle">
                      Set {provider.requiredEnv.join(', ')} and restart — everything else is already
                      wired.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {execution.data && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {execution.data.phase === 'live' ? (
                <CheckCircle2 className="size-4 text-success" />
              ) : execution.data.phase === 'failed' ? (
                <XCircle className="size-4 text-danger" />
              ) : (
                <Spinner className="size-4" />
              )}
              Deployment · {execution.data.provider}
              <Badge variant={PHASE_VARIANT[execution.data.phase]}>{execution.data.phase}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {execution.data.url && (
              <a
                href={execution.data.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-sm text-accent hover:underline"
              >
                {execution.data.url} <ExternalLink className="size-3.5" />
              </a>
            )}
            {execution.data.error && <p className="text-xs text-danger">{execution.data.error}</p>}
            <ol className="space-y-1 border-l border-line pl-3">
              {execution.data.transitions.slice(-8).map((transition) => (
                <li key={`${transition.at}-${transition.detail}`} className="text-xs text-fg-muted">
                  <span className="font-mono text-2xs text-fg-subtle">
                    {new Date(transition.at).toLocaleTimeString()}
                  </span>{' '}
                  {transition.detail}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
