/**
 * Store tests — the invariants features rely on without re-checking:
 * a fresh analysis invalidates the downstream plan (stale-pipeline bugs
 * are the worst kind of subtle), toasts are addressable by id, and the
 * theme setter actually stamps the <html> class the stylesheet keys on.
 */
import { beforeEach, describe, expect, it } from 'vitest';

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
