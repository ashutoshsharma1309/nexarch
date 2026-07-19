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
import { useSettingsStore } from './settings-store';

const themeOptions: { value: Theme; label: string; caption: string }[] = [
  { value: 'dark', label: 'Dark', caption: 'Default' },
  { value: 'light', label: 'Light', caption: 'For bright rooms' },
];

export function SettingsPage() {
  useDocumentTitle('Settings');
  const theme = useUiStore((state) => state.theme);
  const setTheme = useUiStore((state) => state.setTheme);
  const { workspaceName, setWorkspaceName } = useSettingsStore();

  const [nameDraft, setNameDraft] = useState(workspaceName);
  const nameChanged = nameDraft.trim() !== workspaceName && nameDraft.trim() !== '';

  return (
    <>
      <PageHeader
        eyebrow="console/settings"
        title="Settings"
        description="Workspace and appearance preferences."
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
              <CardTitle>Model providers</CardTitle>
              <Badge variant="accent">Phase 2</Badge>
            </div>
            <CardDescription>
              API keys for the generation pipeline are configured here once the pipeline ships. Keys
              will be stored encrypted and never leave the server.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-w-xs">
              <Label htmlFor="api-key">Provider API key</Label>
              <Input id="api-key" type="password" disabled placeholder="Available in Phase 2" />
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
