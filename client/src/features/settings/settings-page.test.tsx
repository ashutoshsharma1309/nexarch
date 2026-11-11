/**
 * Settings has one rule: nothing on this screen may claim an effect it does
 * not have. Status rows must be the server's answer, an unreachable server
 * must read as unknown rather than as an empty list, and the controls that
 * remain must say they live in this browser.
 */
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchHealth } from '@/shared/services/health.service';
import { useUiStore } from '@/shared/store/ui.store';
import type { HealthReport } from '@/shared/types/api';
import { renderWithProviders } from '@/test/utils';
import { useSettingsStore } from './settings-store';
import { SettingsPage } from './settings-page';

vi.mock('@/shared/services/health.service', () => ({ fetchHealth: vi.fn() }));

const report = {
  status: 'ok',
  timestamp: new Date().toISOString(),
  uptimeSeconds: 7200,
  environment: 'development',
  version: '1.2.3',
  checks: {
    database: { status: 'up', latencyMs: 4 },
    aiProvider: { status: 'down', error: 'No AI provider is configured' },
    agentRuntime: { status: 'up' },
    storage: { status: 'up' },
  },
} as unknown as HealthReport;

function row(label: string): HTMLElement {
  const item = screen.getByText(label).closest('li');
  if (!item) throw new Error(`no status row for ${label}`);
  return item;
}

beforeEach(() => {
  vi.mocked(fetchHealth).mockReset();
  vi.mocked(fetchHealth).mockResolvedValue(report);
  localStorage.removeItem('nexarch.settings');
  useSettingsStore.setState({ favoriteNewProjects: false });
  useUiStore.setState({ theme: 'dark' });
});

describe('SettingsPage: server status', () => {
  it('shows each dependency as the server reported it', async () => {
    renderWithProviders(<SettingsPage />);

    expect(await screen.findByText('Operational')).toBeInTheDocument();
    expect(within(row('Database')).getByText(/Up · 4 ms/)).toBeInTheDocument();
    expect(within(row('AI provider')).getByText('Down')).toBeInTheDocument();
    expect(
      within(row('AI provider')).getByText('No AI provider is configured'),
    ).toBeInTheDocument();
    expect(screen.getByText(/v1\.2\.3/)).toBeInTheDocument();
  });

  it('marks a check an older server does not send as not reported, never as up', async () => {
    vi.mocked(fetchHealth).mockResolvedValue({
      ...report,
      checks: { database: { status: 'up' } },
    } as unknown as HealthReport);
    renderWithProviders(<SettingsPage />);

    await screen.findByText('Operational');
    expect(within(row('Run storage')).getByText('Not reported')).toBeInTheDocument();
  });

  it('says the status is unknown when the server cannot be reached', async () => {
    vi.mocked(fetchHealth).mockRejectedValue(new Error('network down'));
    renderWithProviders(<SettingsPage />);

    expect(await screen.findByText(/could not be reached/i)).toBeInTheDocument();
    expect(screen.queryByText('Operational')).not.toBeInTheDocument();
  });
});

describe('SettingsPage: controls', () => {
  it('offers no provider or model picker, and says why', async () => {
    renderWithProviders(<SettingsPage />);
    await screen.findByText('Operational');

    // Nothing reads a preference from here: the server routes by complexity.
    expect(screen.queryByLabelText('Provider')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Model')).not.toBeInTheDocument();
    expect(screen.getByText(/routed by task complexity/i)).toBeInTheDocument();
  });

  it('labels the remaining preferences as stored in this browser', async () => {
    renderWithProviders(<SettingsPage />);
    await screen.findByText('Operational');

    expect(screen.getAllByText('Saved in this browser')).toHaveLength(2);
  });

  it('applies the theme and the new-project default', async () => {
    renderWithProviders(<SettingsPage />);
    await screen.findByText('Operational');

    await userEvent.click(screen.getByRole('radio', { name: /Drafting film/ }));
    expect(useUiStore.getState().theme).toBe('light');

    await userEvent.click(screen.getByLabelText('Favorite new projects automatically'));
    expect(useSettingsStore.getState().favoriteNewProjects).toBe(true);
  });
});
