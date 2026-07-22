import { useState } from 'react';

import { PageHeader } from '@/shared/components/page-header';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { useDocumentTitle } from '@/shared/hooks/use-document-title';
import { cn } from '@/shared/lib/cn';
import { useUiStore } from '@/shared/store/ui.store';
import type { Theme } from '@/shared/store/ui.store';
import type { AiProviderId, ExportFormat } from '@/shared/types/api';
import { useSettingsStore } from './settings-store';

const themeOptions: { value: Theme; label: string; caption: string }[] = [
  { value: 'dark', label: 'Dark', caption: 'Default' },
  { value: 'light', label: 'Light', caption: 'For bright rooms' },
];

const providerOptions: { value: AiProviderId; label: string }[] = [
  { value: 'mock', label: 'Mock' },
  { value: 'claude', label: 'Claude' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'openrouter', label: 'OpenRouter' },
];

const modelsByProvider: Record<AiProviderId, string[]> = {
  mock: ['mock-fast'],
  claude: ['claude-haiku-4-5-20251001', 'claude-opus-4-8'],
  openai: ['gpt-5-mini'],
  gemini: ['gemini-2.5-pro'],
  openrouter: ['openrouter/auto'],
};

const exportFormatOptions: { value: ExportFormat; label: string }[] = [
  { value: 'zip-project', label: 'Full project ZIP' },
  { value: 'docker-package', label: 'Docker package' },
  { value: 'readme', label: 'README' },
  { value: 'openapi', label: 'OpenAPI contract' },
  { value: 'postman-collection', label: 'Postman collection' },
  { value: 'prisma-schema', label: 'Prisma schema' },
  { value: 'sql-schema', label: 'SQL schema' },
  { value: 'architecture-report', label: 'Architecture report' },
  { value: 'dependency-graph', label: 'Dependency graph JSON' },
  { value: 'security-report', label: 'Security report' },
  { value: 'project-manifest', label: 'Project manifest' },
];

const selectClassName = cn(
  'h-8 w-full rounded-md border border-line bg-inset px-2.5 text-[0.8125rem] text-fg',
  'transition-colors duration-100 hover:border-line-strong',
  'focus:border-accent focus:outline-none',
);

export function SettingsPage() {
  useDocumentTitle('Settings');
  const theme = useUiStore((state) => state.theme);
  const setTheme = useUiStore((state) => state.setTheme);
  const {
    workspaceName,
    setWorkspaceName,
    preferredProvider,
    setPreferredProvider,
    preferredModel,
    setPreferredModel,
    maxTokensPerRequest,
    setMaxTokensPerRequest,
    defaultExportFormat,
    setDefaultExportFormat,
    favoriteNewProjects,
    setFavoriteNewProjects,
  } = useSettingsStore();

  const [nameDraft, setNameDraft] = useState(workspaceName);
  const nameChanged = nameDraft.trim() !== workspaceName && nameDraft.trim() !== '';

  return (
    <>
      <PageHeader
        eyebrow="console/settings"
        title="Settings"
        description="Workspace, generation, and export preferences."
      />

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Workspace</CardTitle>
            <CardDescription>Shown in the sidebar and on exported documentation.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-w-xs">
              <Label htmlFor="workspace-name">Workspace name</Label>
              <Input
                id="workspace-name"
                value={nameDraft}
                onChange={(event) => {
                  setNameDraft(event.target.value);
                }}
              />
            </div>
          </CardContent>
          <CardFooter className="justify-end">
            <Button
              variant="primary"
              disabled={!nameChanged}
              onClick={() => {
                setWorkspaceName(nameDraft.trim());
              }}
            >
              Save changes
            </Button>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Appearance</CardTitle>
            <CardDescription>Applies immediately and persists on this device.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-3" role="radiogroup" aria-label="Theme">
              {themeOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={theme === option.value}
                  onClick={() => {
                    setTheme(option.value);
                  }}
                  className={cn(
                    'max-w-44 flex-1 rounded-md border px-4 py-3 text-left transition-colors duration-100',
                    theme === option.value
                      ? 'border-accent bg-accent-soft'
                      : 'border-line hover:border-line-strong',
                  )}
                >
                  <p className="text-sm font-medium text-fg">{option.label}</p>
                  <p className="mt-0.5 text-xs text-fg-muted">{option.caption}</p>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <CardTitle>AI provider</CardTitle>
              <Badge variant="accent">Preference</Badge>
            </div>
            <CardDescription>
              Saved for the AI Orchestrator to read once it exposes a per-request override; today
              every request routes through its own complexity-based model router regardless of this
              setting.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="provider-select">Provider</Label>
              <select
                id="provider-select"
                className={selectClassName}
                value={preferredProvider}
                onChange={(event) => {
                  const provider = event.target.value as AiProviderId;
                  setPreferredProvider(provider);
                  const firstModel = modelsByProvider[provider][0];
                  if (firstModel) setPreferredModel(firstModel);
                }}
              >
                {providerOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="model-select">Model</Label>
              <select
                id="model-select"
                className={selectClassName}
                value={preferredModel}
                onChange={(event) => {
                  setPreferredModel(event.target.value);
                }}
              >
                {modelsByProvider[preferredProvider].map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="token-limit">Max tokens per request</Label>
              <Input
                id="token-limit"
                type="number"
                min={500}
                max={200000}
                step={500}
                value={maxTokensPerRequest}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (!Number.isNaN(value)) setMaxTokensPerRequest(value);
                }}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Export defaults</CardTitle>
            <CardDescription>
              Highlighted as the default format on the Export Center.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-w-xs">
              <Label htmlFor="export-format-select">Default export format</Label>
              <select
                id="export-format-select"
                className={selectClassName}
                value={defaultExportFormat}
                onChange={(event) => {
                  setDefaultExportFormat(event.target.value as ExportFormat);
                }}
              >
                {exportFormatOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Project defaults</CardTitle>
            <CardDescription>Applied automatically when a new project is created.</CardDescription>
          </CardHeader>
          <CardContent>
            <label className="flex items-center gap-2.5 text-xs text-fg-muted">
              <input
                type="checkbox"
                checked={favoriteNewProjects}
                onChange={(event) => {
                  setFavoriteNewProjects(event.target.checked);
                }}
                className="size-3.5 rounded-sm border-line accent-accent"
              />
              Favorite new projects automatically
            </label>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
