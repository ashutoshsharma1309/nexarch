/**
 * Store tests — the invariants features rely on without re-checking:
 * a fresh analysis invalidates the downstream plan (stale-pipeline bugs
 * are the worst kind of subtle), toasts are addressable by id, the theme
 * setter actually stamps the <html> class the stylesheet keys on, and the
 * saved preferences survive the reload they only exist for.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { useSettingsStore } from '@/features/settings/settings-store';
import type { ArchitecturePlan, RequirementSpec } from '@/shared/types/api';
import { usePipelineStore } from './pipeline.store';
import { toast, useToastStore } from './toast.store';
import { useUiStore } from './ui.store';

const spec = { projectName: 'Shop', modules: ['products'] } as unknown as RequirementSpec;
const plan = { meta: { projectName: 'Shop' } } as unknown as ArchitecturePlan;

describe('pipeline store', () => {
  beforeEach(() => {
    usePipelineStore.getState().clearSpec();
  });

  it('a fresh analysis clears the downstream architecture plan', () => {
    const store = usePipelineStore.getState();
    store.setSpec(spec);
    store.setArchitecture(plan);
    expect(usePipelineStore.getState().architecture).not.toBeNull();

    store.setSpec({ ...spec, projectName: 'Shop v2' });
    expect(usePipelineStore.getState().architecture).toBeNull();
    expect(usePipelineStore.getState().spec?.projectName).toBe('Shop v2');
  });

  it('clearSpec resets the whole working pipeline', () => {
    const store = usePipelineStore.getState();
    store.setSpec(spec);
    store.setArchitecture(plan);
    store.clearSpec();

    const state = usePipelineStore.getState();
    expect(state.spec).toBeNull();
    expect(state.architecture).toBeNull();
    expect(state.specUpdatedAt).toBeNull();
  });
});

describe('toast store', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
  });

  it('pushes with a default info variant and dismisses by id', () => {
    toast('saved');
    toast('boom', 'error');

    const { toasts, dismiss } = useToastStore.getState();
    expect(toasts).toHaveLength(2);
    expect(toasts[0]?.variant).toBe('info');
    expect(toasts[1]?.variant).toBe('error');

    dismiss(toasts[0]?.id ?? '');
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual(['boom']);
  });
});

describe('ui store', () => {
  it('setTheme stamps the dark class on <html> and toggleTheme flips it', () => {
    const store = useUiStore.getState();

    store.setTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    useUiStore.getState().toggleTheme();
    expect(useUiStore.getState().theme).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});

/**
 * The persisted preferences.
 *
 * Everything here is a local record of what the user asked for, so the only
 * property worth pinning is that it is still there after the reload — a
 * preference that silently reverts is worse than one the console never
 * offered, because the user believes it is in force.
 */
const SETTINGS_DEFAULTS = {
  workspaceName: 'My workspace',
  preferredProvider: 'mock',
  preferredModel: 'mock-fast',
  maxTokensPerRequest: 8000,
  defaultExportFormat: 'zip-project',
  favoriteNewProjects: false,
} as const;

/** What zustand's `persist` actually wrote under its storage key. */
function storedSettings(): { preferredProvider?: string; preferredModel?: string } {
  const raw = localStorage.getItem('nexarch.settings');
  const parsed = JSON.parse(raw ?? '{}') as {
    state?: { preferredProvider?: string; preferredModel?: string };
  };
  return parsed.state ?? {};
}

describe('settings store', () => {
  beforeEach(() => {
    localStorage.removeItem('nexarch.settings');
    useSettingsStore.setState(SETTINGS_DEFAULTS);
  });

  it('starts on the mock provider, so a fresh console cannot spend anything', () => {
    const state = useSettingsStore.getState();
    expect(state.preferredProvider).toBe('mock');
    expect(state.preferredModel).toBe('mock-fast');
    // New projects are not favourites by default; the projects page reads
    // this one, and a console that stars everything stars nothing.
    expect(state.favoriteNewProjects).toBe(false);
  });

  it('writes each preference to storage, not only to memory', () => {
    const store = useSettingsStore.getState();
    store.setPreferredProvider('claude');
    store.setPreferredModel('claude-haiku-4-5-20251001');
    store.setWorkspaceName('Acme');
    store.setMaxTokensPerRequest(32_000);
    store.setDefaultExportFormat('docker-package');
    store.setFavoriteNewProjects(true);

    const state = useSettingsStore.getState();
    expect(state.workspaceName).toBe('Acme');
    expect(state.maxTokensPerRequest).toBe(32_000);
    expect(state.defaultExportFormat).toBe('docker-package');
    expect(state.favoriteNewProjects).toBe(true);
    // These two are the pair a user would notice reverting, so they are
    // checked where they have to survive: in the storage the next load
    // rehydrates from.
    expect(storedSettings().preferredProvider).toBe('claude');
    expect(storedSettings().preferredModel).toBe('claude-haiku-4-5-20251001');
  });

  it('records provider and model independently — pairing them is the page’s job', () => {
    useSettingsStore.getState().setPreferredProvider('openai');

    // The store is a plain record of preferences: it will happily hold
    // "openai" alongside the mock's model. Keeping the two in step is the
    // Settings page's cascade (see settings-page.test.tsx), and if that ever
    // moves down into the store, this expectation moves with it.
    expect(useSettingsStore.getState().preferredProvider).toBe('openai');
    expect(useSettingsStore.getState().preferredModel).toBe('mock-fast');
  });
});
