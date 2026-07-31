import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  ExternalLink,
  FolderGit2,
  GitBranch,
  GitCommitHorizontal,
  Lock,
  Send,
  Unplug,
} from 'lucide-react';

import { useGeneratedBackend } from '@/features/backend/use-generated-backend';
import { useGeneratedFrontend } from '@/features/frontend/use-generated-frontend';
import { PageHeader } from '@/shared/components/page-header';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { EmptyState } from '@/shared/components/ui/empty-state';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { Spinner } from '@/shared/components/ui/spinner';
import { useDocumentTitle } from '@/shared/hooks/use-document-title';
import {
  useCreateGithubRepo,
  useGithubCommits,
  useGithubRepos,
  useGithubStatus,
  useGithubUser,
  usePlanGithubPush,
  usePushToGithub,
} from '@/shared/hooks/use-github';
import { usePipelineStore } from '@/shared/store/pipeline.store';
import { toast } from '@/shared/store/toast.store';
import { cn } from '@/shared/lib/cn';
import type { GithubPushFile, GithubPushRequest } from '@/shared/types/api';

function ConnectCard({ enableHint }: { enableHint: string | null }) {
  return (
    <EmptyState
      icon={<Unplug className="size-4" />}
      title="GitHub is not connected"
      description={
        enableHint ??
        'Set GITHUB_TOKEN in the server environment and restart — everything below lights up automatically.'
      }
    />
  );
}

export function GithubPage() {
  useDocumentTitle('GitHub');
  const status = useGithubStatus();
  const configured = status.data?.configured ?? false;
  const user = useGithubUser(configured);
  const repos = useGithubRepos(configured);
  const createRepo = useCreateGithubRepo();
  const planPush = usePlanGithubPush();
  const push = usePushToGithub();

  const architecture = usePipelineStore((state) => state.architecture);
  const backend = useGeneratedBackend();
  const frontend = useGeneratedFrontend();

  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const [branch, setBranch] = useState('main');
  const [message, setMessage] = useState('Generated with NexArch');
  const [newRepoName, setNewRepoName] = useState('');

  const selected = repos.data?.find((repo) => repo.fullName === selectedRepo) ?? null;
  const commits = useGithubCommits(selected?.owner ?? null, selected?.name ?? null, branch);

  const files = useMemo<GithubPushFile[]>(() => {
    if (!backend.data || !frontend.data) return [];
    return [
      ...backend.data.files.map((f) => ({ path: `backend/${f.path}`, content: f.content })),
      ...frontend.data.files.map((f) => ({ path: `frontend/${f.path}`, content: f.content })),
    ];
  }, [backend.data, frontend.data]);

  const pushRequest: GithubPushRequest | null =
    selected && files.length > 0 && architecture
      ? {
          owner: selected.owner,
          repo: selected.name,
          branch,
          message,
          files,
          generateReadme: true,
          projectMeta: {
            projectName: architecture.meta.projectName,
            stack: ['Express 5', 'Prisma', 'MySQL', 'React 19', 'Vite', 'TailwindCSS'],
          },
        }
      : null;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="console/github"
        title="GitHub"
        description="Push the generated project to a repository — plan first, then one reviewable commit"
      />

      {status.isPending ? (
        <Skeleton className="h-40" />
      ) : !configured ? (
        <ConnectCard enableHint={status.data?.enableHint ?? null} />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <FolderGit2 className="size-4" /> Connected account
              </CardTitle>
            </CardHeader>
            <CardContent>
              {user.data ? (
                <div className="flex items-center gap-3">
                  <p className="text-sm text-fg">{user.data.name ?? user.data.login}</p>
                  <a
                    href={user.data.htmlUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
                  >
                    @{user.data.login} <ExternalLink className="size-3" />
                  </a>
                  <Badge variant="neutral">{user.data.publicRepos} public repos</Badge>
                </div>
              ) : (
                <Skeleton className="h-6 w-64" />
              )}
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
            <Card className="h-fit">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <FolderGit2 className="size-4" /> Repositories
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex gap-2">
                  <Input
                    placeholder="new-repo-name"
                    value={newRepoName}
                    onChange={(event) => {
                      setNewRepoName(event.target.value);
                    }}
                  />
                  <Button
                    size="sm"
                    disabled={newRepoName.trim().length === 0 || createRepo.isPending}
                    onClick={() => {
                      createRepo.mutate(
                        { name: newRepoName.trim(), private: true },
                        {
                          onSuccess: (repo) => {
                            setSelectedRepo(repo.fullName);
                            setNewRepoName('');
                            toast(`Created ${repo.fullName}`, 'success');
                          },
                          onError: (error) => {
                            toast(error.message, 'error');
                          },
                        },
                      );
                    }}
                  >
                    {createRepo.isPending ? <Spinner className="size-3.5" /> : 'Create'}
                  </Button>
                </div>
                <div className="max-h-96 space-y-1 overflow-y-auto">
                  {repos.isPending ? (
                    <Skeleton className="h-24" />
                  ) : (
                    (repos.data ?? []).map((repo) => (
                      <button
                        key={repo.fullName}
                        type="button"
                        onClick={() => {
                          setSelectedRepo(repo.fullName);
                          setBranch(repo.defaultBranch);
                        }}
                        className={cn(
                          'flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-xs transition-colors',
                          repo.fullName === selectedRepo
                            ? 'bg-raised text-fg'
                            : 'text-fg-muted hover:bg-raised/60',
                        )}
                      >
                        <span className="truncate">{repo.fullName}</span>
                        {repo.private && <Lock className="size-3 shrink-0 text-fg-subtle" />}
                      </button>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>

            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Send className="size-4" /> Push generated project
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {files.length === 0 ? (
                    <p className="text-sm text-fg-subtle">
                      Generate a project in the Forge first — there is nothing to push yet.
                    </p>
                  ) : !selected ? (
                    <p className="text-sm text-fg-subtle">Select or create a repository.</p>
                  ) : (
                    <>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label htmlFor="gh-branch">Branch</Label>
                          <Input
                            id="gh-branch"
                            value={branch}
                            onChange={(event) => {
                              setBranch(event.target.value);
                            }}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="gh-message">Commit message</Label>
                          <Input
                            id="gh-message"
                            value={message}
                            onChange={(event) => {
                              setMessage(event.target.value);
                            }}
                          />
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button
                          disabled={!pushRequest || planPush.isPending}
                          onClick={() => {
                            if (!pushRequest) return;
                            planPush.mutate(pushRequest, {
                              onError: (error) => {
                                toast(error.message, 'error');
                              },
                            });
                          }}
                        >
                          {planPush.isPending ? <Spinner className="size-4" /> : 'Plan push'}
                        </Button>
                        <Button
                          disabled={!pushRequest || push.isPending}
                          onClick={() => {
                            if (!pushRequest) return;
                            push.mutate(pushRequest, {
                              onSuccess: (result) => {
                                toast(`Pushed ${String(result.filesPushed)} files`, 'success');
                              },
                              onError: (error) => {
                                toast(error.message, 'error');
                              },
                            });
                          }}
                        >
                          {push.isPending ? (
                            <Spinner className="size-4" />
                          ) : (
                            <Send className="size-4" />
                          )}
                          Push {files.length} files
                        </Button>
                      </div>

                      {planPush.data && (
                        <div className="rounded-md border border-line bg-raised/40 p-3">
                          <p className="text-xs font-medium text-fg">
                            {planPush.data.fileCount} files ·{' '}
                            {(planPush.data.totalBytes / 1024).toFixed(0)} KB
                            {planPush.data.readmeIncluded && ' · README generated'}
                          </p>
                          <ol className="mt-2 list-inside list-decimal space-y-0.5">
                            {planPush.data.steps.map((step) => (
                              <li key={step.name} className="text-xs text-fg-muted">
                                {step.description}
                              </li>
                            ))}
                          </ol>
                          {planPush.data.warnings.map((warning) => (
                            <p key={warning} className="mt-2 text-xs text-warning">
                              {warning}
                            </p>
                          ))}
                        </div>
                      )}

                      {push.data && (
                        <div className="flex items-center gap-2 rounded-md border border-success/40 bg-success/5 p-3">
                          <CheckCircle2 className="size-4 text-success" />
                          <a
                            href={push.data.commitUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-accent hover:underline"
                          >
                            {push.data.commitSha.slice(0, 10)} on {push.data.branch}
                          </a>
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>

              {selected && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <GitCommitHorizontal className="size-4" /> History
                      <Badge variant="neutral">
                        <span className="flex items-center gap-1">
                          <GitBranch className="size-3" /> {branch}
                        </span>
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {commits.isPending ? (
                      <Skeleton className="h-24" />
                    ) : commits.isError ? (
                      <p className="text-xs text-fg-subtle">
                        No commits found on “{branch}” — push something first.
                      </p>
                    ) : (
                      <ul className="space-y-2">
                        {commits.data.slice(0, 10).map((commit) => (
                          <li key={commit.sha} className="flex items-baseline gap-3">
                            <a
                              href={commit.htmlUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="font-mono text-2xs text-accent hover:underline"
                            >
                              {commit.sha.slice(0, 7)}
                            </a>
                            <span className="truncate text-xs text-fg-muted">
                              {commit.message.split('\n')[0]}
                            </span>
                            <span className="ml-auto shrink-0 text-2xs text-fg-subtle">
                              {commit.author}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
