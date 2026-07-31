import { useState } from 'react';
import {
  Activity,
  Download,
  GitBranch,
  HeartPulse,
  Rocket,
  ScrollText,
  ShieldCheck,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { CodeViewer } from '@/features/database/components/code-viewer';
import { LaunchSection } from '@/features/deployment/launch-section';
import { PageHeader } from '@/shared/components/page-header';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { EmptyState } from '@/shared/components/ui/empty-state';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { useCurrentArtifacts } from '@/shared/hooks/use-current-artifacts';
import {
  useDeploymentHealth,
  useDeploymentStatus,
  useExportDeployment,
  useGenerateDeployment,
} from '@/shared/hooks/use-deployment';
import { useDocumentTitle } from '@/shared/hooks/use-document-title';
import { cn } from '@/shared/lib/cn';
import { downloadText } from '@/shared/lib/download';
import { slugify } from '@/shared/lib/slugify';
import { downloadZip } from '@/shared/lib/zip';
import { toast } from '@/shared/store/toast.store';
import type { DeploymentExportFormat, DeploymentFile, DeploymentTarget } from '@/shared/types/api';

const TARGET_OPTIONS: { value: DeploymentTarget; label: string }[] = [
  { value: 'docker', label: 'Docker' },
  { value: 'docker-compose', label: 'Docker Compose' },
  { value: 'vercel', label: 'Vercel' },
  { value: 'netlify', label: 'Netlify' },
  { value: 'render', label: 'Render' },
  { value: 'railway', label: 'Railway' },
  { value: 'aws-ec2', label: 'AWS EC2' },
  { value: 'aws-ecs', label: 'AWS ECS' },
  { value: 'gcp-cloud-run', label: 'Google Cloud Run' },
  { value: 'azure-app-service', label: 'Azure App Service' },
  { value: 'digitalocean', label: 'DigitalOcean' },
  { value: 'local', label: 'Local' },
];

const LANGUAGE_MIME: Record<DeploymentFile['language'], string> = {
  dockerfile: 'text/plain',
  yaml: 'text/yaml',
  shellscript: 'text/x-sh',
  ignore: 'text/plain',
  env: 'text/plain',
  markdown: 'text/markdown',
  json: 'application/json',
  typescript: 'text/typescript',
};

const EXPORT_OPTIONS: { format: DeploymentExportFormat; label: string; description: string }[] = [
  {
    format: 'dockerfile',
    label: 'Dockerfile(s)',
    description: 'Backend + frontend Dockerfiles, archived.',
  },
  { format: 'docker-compose', label: 'docker-compose.yml', description: 'Development stack.' },
  {
    format: 'docker-compose-prod',
    label: 'docker-compose.prod.yml',
    description: 'Production overlay.',
  },
  {
    format: 'github-workflow-build',
    label: 'build.yml',
    description: 'Lint, build, test, security scan, docker build.',
  },
  {
    format: 'github-workflow-deploy',
    label: 'deploy.yml',
    description: 'Release + deploy on version tags.',
  },
  { format: 'env-example', label: '.env.example', description: 'Environment variable template.' },
  {
    format: 'deployment-guide',
    label: 'deployment-guide.md',
    description: 'The full target-specific guide.',
  },
  {
    format: 'docker-package',
    label: 'Docker package',
    description: 'Dockerfiles, .dockerignore, both compose files.',
  },
  {
    format: 'environment-package',
    label: 'Environment package',
    description: 'All three env files + docs.',
  },
  { format: 'cicd-package', label: 'CI/CD package', description: 'Both GitHub Actions workflows.' },
  {
    format: 'deployment-package',
    label: 'Deployment package',
    description: 'Target config + backup + scalability + guide.',
  },
  {
    format: 'complete-zip',
    label: 'Complete ZIP',
    description: 'Everything this page generated, in one archive.',
  },
];

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-fg">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  );
}

export function DeploymentPage() {
  useDocumentTitle('Deployment');
  const navigate = useNavigate();
  const { artifacts } = useCurrentArtifacts();
  const [target, setTarget] = useState<DeploymentTarget>('docker-compose');
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const status = useDeploymentStatus();
  const health = useDeploymentHealth();
  const generate = useGenerateDeployment();
  const exportMutation = useExportDeployment();

  const bundle = generate.data;

  const allFiles: DeploymentFile[] = bundle
    ? [
        bundle.docker.dockerignoreBackend,
        bundle.docker.dockerignoreFrontend,
        bundle.docker.composeDev,
        bundle.docker.composeProd,
        bundle.cicd.buildWorkflow,
        bundle.cicd.deployWorkflow,
        bundle.environment.envExample,
        bundle.environment.envDevelopment,
        bundle.environment.envProduction,
        ...bundle.health.files,
        ...bundle.monitoring.files,
        ...bundle.logging.files,
        ...bundle.targetConfig.files,
      ]
    : [];
  const selected = allFiles.find((f) => f.path === selectedPath) ?? allFiles[0];

  const handleGenerate = (): void => {
    if (!artifacts) return;
    generate.mutate(
      { target, artifacts },
      {
        onSuccess: (result) => {
          setSelectedPath(result.docker.composeDev.path);
          toast(`Deployment infrastructure generated for ${target}`, 'success');
        },
        onError: () => {
          toast('Could not generate deployment infrastructure', 'error');
        },
      },
    );
  };

  const handleExport = (format: DeploymentExportFormat): void => {
    if (!artifacts) return;
    exportMutation.mutate(
      { format, target, artifacts },
      {
        onSuccess: (result) => {
          const slug = slugify(artifacts.projectName, 'project');
          if (result.kind === 'file') {
            downloadText(result.filename, result.content, result.mimeType);
          } else {
            downloadZip(`${slug}-${format}.zip`, result.files);
          }
          toast('Export ready — check your downloads', 'success');
        },
        onError: () => {
          toast('Export failed', 'error');
        },
      },
    );
  };

  return (
    <>
      <PageHeader
        eyebrow="console/deployment"
        title="Deployment"
        description="Docker, CI/CD, environment, health, and monitoring infrastructure for the current project."
        actions={
          status.data && (
            <Badge variant={status.data.ready ? 'success' : 'neutral'}>
              {status.data.supportedTargets.length} targets supported
            </Badge>
          )
        }
      />

      {!artifacts ? (
        <EmptyState
          icon={<Rocket className="size-4" />}
          title="Nothing to deploy yet"
          description="Run the forge first — deployment infrastructure is generated from the live pipeline."
          action={
            <Button
              variant="forge"
              onClick={() => {
                void navigate('/forge');
              }}
            >
              Open the forge
            </Button>
          }
        />
      ) : (
        <>
          <Card>
            <CardContent className="flex flex-wrap items-end justify-between gap-3 py-4">
              <div className="max-w-xs flex-1">
                <label
                  htmlFor="deployment-target"
                  className="mb-1.5 block text-xs font-medium text-fg-muted"
                >
                  Deployment target
                </label>
                <select
                  id="deployment-target"
                  value={target}
                  onChange={(event) => {
                    setTarget(event.target.value as DeploymentTarget);
                  }}
                  className="h-8 w-full rounded-md border border-line bg-inset px-2.5 text-[0.8125rem] text-fg transition-colors duration-100 hover:border-line-strong focus:border-accent focus:outline-none"
                >
                  {TARGET_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <Button variant="forge" loading={generate.isPending} onClick={handleGenerate}>
                Generate deployment infrastructure
              </Button>
            </CardContent>
          </Card>

          {generate.isPending && (
            <div className="mt-6 space-y-2">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          )}

          {bundle && (
            <>
              <Section title="Environment variables" icon={<ShieldCheck className="size-4" />}>
                <Card>
                  <ul className="divide-y divide-line">
                    {bundle.environment.validationRules.map((rule) => (
                      <li key={rule.name} className="flex items-center gap-3 px-5 py-2.5">
                        <span className="w-44 shrink-0 truncate font-mono text-2xs text-fg">
                          {rule.name}
                        </span>
                        <Badge variant={rule.required ? 'accent' : 'neutral'}>
                          {rule.required ? 'required' : 'optional'}
                        </Badge>
                        {rule.secret && <Badge variant="warning">secret</Badge>}
                        <p className="min-w-0 flex-1 truncate text-xs text-fg-muted">
                          {rule.description}
                        </p>
                      </li>
                    ))}
                  </ul>
                </Card>
              </Section>

              <Section title="Generated files" icon={<GitBranch className="size-4" />}>
                <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
                  <ul className="max-h-[32rem] space-y-0.5 overflow-y-auto rounded-lg border border-line bg-inset px-2 py-2">
                    {allFiles.map((file) => (
                      <li key={file.path}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedPath(file.path);
                          }}
                          className={cn(
                            'block w-full truncate rounded-sm px-2 py-1 text-left font-mono text-2xs',
                            (selected?.path ?? '') === file.path
                              ? 'bg-accent-soft text-accent'
                              : 'text-fg-muted hover:bg-raised/60 hover:text-fg',
                          )}
                        >
                          {file.path}
                        </button>
                      </li>
                    ))}
                  </ul>
                  {selected && (
                    <CodeViewer
                      code={selected.content}
                      filename={selected.path.split('/').pop() ?? selected.path}
                      mime={LANGUAGE_MIME[selected.language]}
                      language={selected.language}
                    />
                  )}
                </div>
              </Section>

              <Section title="CI/CD" icon={<Activity className="size-4" />}>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="neutral">build.yml runs on every push / PR</Badge>
                  <Badge variant="neutral">deploy.yml runs on version tags (v*.*.*)</Badge>
                </div>
              </Section>

              <Section title="Health status" icon={<HeartPulse className="size-4" />}>
                <Card>
                  <CardContent className="py-4">
                    {health.isPending ? (
                      <Skeleton className="h-16" />
                    ) : (
                      <>
                        <p className="text-xs text-fg-muted">{health.data?.note}</p>
                        <ul className="mt-3 space-y-1.5">
                          {health.data?.checks.map((check) => (
                            <li key={check.path} className="flex items-center gap-3 text-xs">
                              <span className="w-28 shrink-0 font-mono text-fg">{check.path}</span>
                              <span className="text-fg-muted">{check.purpose}</span>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </CardContent>
                </Card>
              </Section>

              <Section title="Logs" icon={<ScrollText className="size-4" />}>
                <EmptyState
                  title="No live deployment"
                  description="This dashboard generates deployment infrastructure — it doesn't deploy anything itself. Logs will appear here once you've deployed to a real target and wired up log shipping (see LOGGING.md in the export)."
                />
              </Section>

              <Section title="Launch" icon={<Rocket className="size-4" />}>
                <LaunchSection artifacts={artifacts} />
              </Section>

              <Section title="Export" icon={<Download className="size-4" />}>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {EXPORT_OPTIONS.map((option) => {
                    const pending =
                      exportMutation.isPending && exportMutation.variables.format === option.format;
                    return (
                      <Card key={option.format}>
                        <CardHeader>
                          <CardTitle>{option.label}</CardTitle>
                        </CardHeader>
                        <CardContent className="flex flex-col gap-3">
                          <p className="text-xs text-fg-muted">{option.description}</p>
                          <Button
                            size="sm"
                            icon={<Download className="size-3.5" />}
                            loading={pending}
                            onClick={() => {
                              handleExport(option.format);
                            }}
                          >
                            Export
                          </Button>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </Section>
            </>
          )}
        </>
      )}
    </>
  );
}
