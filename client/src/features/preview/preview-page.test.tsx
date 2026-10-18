/**
 * The run-slot limit is per user and counts every project, but the preview
 * page is scoped to one project. A refused preview was therefore a dead end:
 * "stop one of your runs" named nothing the reader could see or reach. These
 * tests pin the way out — the other projects' runs are listed here, and each
 * can be stopped without leaving the page.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { RunSession } from '@/shared/types/api';
import { OtherRuns } from './preview-page';

const stopRunSession = vi.hoisted(() => vi.fn());
vi.mock('@/shared/services/runner.service', () => ({
  stopRunSession,
  createRunSession: vi.fn(),
  restartRunSession: vi.fn(),
  getRunSession: vi.fn(),
  getRunLogs: vi.fn(),
  listRunSessions: vi.fn(),
}));

function session(name: string, id: string): RunSession {
  return {
    id,
    projectName: name,
    phase: 'running',
    processes: [],
    transitions: [],
    workspaceDir: `/tmp/${id}`,
    diagnostics: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function renderOtherRuns(sessions: RunSession[]) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <OtherRuns sessions={sessions} />
    </QueryClientProvider>,
  );
}

describe('OtherRuns', () => {
  it('names each project holding a run slot', () => {
    renderOtherRuns([session('College', 'a'), session('NovaStack', 'b')]);
    expect(screen.getByText('College')).toBeInTheDocument();
    expect(screen.getByText('NovaStack')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /stop/i })).toHaveLength(2);
  });

  it('stops the run the reader picked, so a slot is freed from this page', async () => {
    stopRunSession.mockResolvedValue(session('College', 'a'));
    renderOtherRuns([session('College', 'a'), session('NovaStack', 'b')]);

    const [, novastack] = screen.getAllByRole('button', { name: /stop/i });
    if (!novastack) throw new Error('expected a stop button for every listed run');

    await userEvent.click(novastack);
    expect(stopRunSession).toHaveBeenCalledWith('b');
  });

  it('renders nothing when no other project is running', () => {
    const { container } = renderOtherRuns([]);
    expect(container).toBeEmptyDOMElement();
  });
});
