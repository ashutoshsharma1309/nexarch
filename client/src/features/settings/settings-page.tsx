/**
 * Settings: what the server reports, and the few preferences that do something.
 *
 * This page used to offer provider, model, token-limit, export-format and
 * workspace-name controls. Nothing read any of them, so choosing "Claude" here
 * changed nothing about a build while looking as if it had. They are gone from
 * the screen. What is left is either read live from the server or labelled as
 * stored in this browser.
 */
import type { ReactNode } from 'react';

import { Badge } from '@/shared/components/ui/badge';
import { PageTitle } from '@/shared/components/ui/page-title';
import { useDocumentTitle } from '@/shared/hooks/use-document-title';
import { cn } from '@/shared/lib/cn';
import { useUiStore } from '@/shared/store/ui.store';
import type { Theme } from '@/shared/store/ui.store';
import { ServerStatus } from './server-status';
import { useSettingsStore } from './settings-store';

const themeOptions: { value: Theme; label: string; caption: string }[] = [
  { value: 'dark', label: 'Cyanotype', caption: 'Dark, the default' },
  { value: 'light', label: 'Drafting film', caption: 'Light, for bright rooms' },
];

function BrowserOnly() {
  return <Badge>Saved in this browser</Badge>;
}

function SettingsSection({
  title,
  description,
  badge,
  children,
}: {
  title: string;
  description: string;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-4 border-t border-line py-6 md:grid-cols-[15rem_minmax(0,1fr)] md:gap-10">
      <div>
        <h2 className="text-base font-semibold tracking-tight text-fg">{title}</h2>
        <p className="mt-1 type-ui leading-relaxed text-fg-muted">{description}</p>
        {badge && <div className="mt-2">{badge}</div>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

export function SettingsPage() {
  useDocumentTitle('Settings');
  const theme = useUiStore((state) => state.theme);
  const setTheme = useUiStore((state) => state.setTheme);
  const favoriteNewProjects = useSettingsStore((state) => state.favoriteNewProjects);
  const setFavoriteNewProjects = useSettingsStore((state) => state.setFavoriteNewProjects);

  return (
    <>
      <PageTitle title="Settings" description="Server status and preferences for this browser." />

      <SettingsSection
        title="Server"
        description="Read live from this NexArch server, refreshed every 30 seconds."
      >
        <ServerStatus />
      </SettingsSection>

      <SettingsSection title="Model routing" description="Decided on the server, not here.">
        <p className="max-w-xl type-ui leading-relaxed text-fg-muted">
          Each model call is routed by task complexity, with failover between the providers
          configured in the server’s environment. There is no per-account override, so this page has
          no provider or model picker. To change routing, edit{' '}
          <code className="font-mono text-xs text-fg">AI_PROVIDER</code> and{' '}
          <code className="font-mono text-xs text-fg">AI_PROVIDER_CHAIN</code> on the server and
          restart it.
        </p>
      </SettingsSection>

      <SettingsSection
        title="Appearance"
        description="Applies immediately."
        badge={<BrowserOnly />}
      >
        <div className="grid max-w-md gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Theme">
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
                'rounded-md border px-3.5 py-2.5 text-left transition-colors duration-100',
                theme === option.value
                  ? 'border-accent bg-accent-soft'
                  : 'border-line hover:border-line-strong',
              )}
            >
              <span className="block type-ui font-medium text-fg">{option.label}</span>
              <span className="mt-0.5 block text-xs text-fg-muted">{option.caption}</span>
            </button>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection
        title="New projects"
        description="Applied when you create a project from this browser."
        badge={<BrowserOnly />}
      >
        <label className="flex items-center gap-2.5 type-ui text-fg">
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
      </SettingsSection>
    </>
  );
}
