/**
 * The ways this workflow could overstate what happened, pinned shut.
 *
 * Nothing here is about layout. Each test holds one promise: a substantial
 * plan waits for a person, progress is the server's own, a skipped check is
 * not a pass, unknown usage is not zero, and undo appears only where the
 * server can do it.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mergeEnhancementEvents } from '@/shared/hooks/use-enhancement';
import {
  applyEnhancement,
  cancelEnhancement,
  fetchCurrentEnhancementJob,
  fetchEnhancementEvents,
  fetchEnhancementJob,
  planEnhancement,
  revertEnhancement,
} from '@/shared/services/enhancement.service';
import type {
  EnhancementJob,
  EnhancementPlan,
  EnhancementResult,
} from '@/shared/services/enhancement.service';
import { fetchCurrentEditJob, planEdit } from '@/shared/services/project-editor.service';
import type { ExecutionEvent } from '@/shared/types/execution';
import { renderWithProviders } from '@/test/utils';
import { instructionWithLinks, parseReferenceLinks, researchPayload } from './enhance-model';
import { EnhanceTab } from './enhance-tab';

vi.mock('@/shared/services/enhancement.service', () => ({
  EVENT_PAGE_LIMIT: 500,
  planEnhancement: vi.fn(),
  applyEnhancement: vi.fn(),
  fetchEnhancementJob: vi.fn(),
  fetchCurrentEnhancementJob: vi.fn(),
  cancelEnhancement: vi.fn(),
  revertEnhancement: vi.fn(),
  fetchEnhancementEvents: vi.fn(),
}));

vi.mock('@/shared/services/project-editor.service', () => ({
  planEdit: vi.fn(),
  fetchEditPlan: vi.fn(() => new Promise(() => undefined)),
  applyEdit: vi.fn(),
  fetchEditJob: vi.fn(),
  fetchCurrentEditJob: vi.fn(),
}));

const workspace = {
  project: { id: 'project-1', name: 'Task Tracker' },
  latestRun: { id: 'run-1' },
  artifacts: null,
  isBuilding: false,
};
vi.mock('../workspace-context', () => ({ useWorkspace: () => workspace }));

class StubImage {
  onload: (() => void) | null = null;
  naturalWidth = 1280;
  naturalHeight = 720;
  set src(_value: string) {
    setTimeout(() => {
      this.onload?.();
    }, 0);
  }
}

function plan(overrides: Partial<EnhancementPlan> = {}): EnhancementPlan {
  return {
    planId: 'plan-1',
    projectId: 'project-1',
    instruction: 'Add login and a dashboard',
    summary: 'Adds sign-in and a protected dashboard.',
    steps: ['Add the auth routes'],
    filesLikelyTouched: ['backend/src/auth.ts'],
    limitations: [],
    createdAt: '2026-11-09T10:00:00.000Z',
    kind: 'add-authentication',
    basedOnRunId: 'run-1',
    files: [{ path: 'backend/src/auth.ts', action: 'create', reason: 'Holds the routes' }],
    impact: {
      direct: ['backend/src/auth.ts'],
      dependents: [],
      tests: [],
      graphUnavailable: false,
      graphUnavailableReason: null,
    },
    substantial: true,
    risks: [],
    envChanges: [],
    research: {
      outcome: 'not-needed',
      reason: 'This can be planned from the project itself, so no web search was run.',
      sourceCount: 0,
      findingCount: 0,
      limitations: [],
    },
    coverage: [],
    validationPlan: ['Install, type-check, build and start the changed project'],
    status: 'planned',
    ...overrides,
  };
}

function result(overrides: Partial<EnhancementResult> = {}): EnhancementResult {
  return {
    planId: 'plan-1',
    projectId: 'project-1',
    status: 'applied',
    runId: 'run-2',
    baseRunId: 'run-1',
    kind: 'add-authentication',
    changedFiles: [
      {
        path: 'backend/src/auth.ts',
        addedLines: 1,
        removedLines: 0,
        hunks: [{ line: 1, removed: [], added: ['export const auth = true;'] }],
      },
    ],
    unchangedFileCount: 12,
    outcome: 'It built, started and passed its checks.',
    rolledBack: false,
    completedAt: '2026-11-09T10:05:00.000Z',
    verification: {
      ran: true,
      ok: true,
      steps: [
        {
          id: 'build',
          status: 'passed',
          command: 'npm run build',
          exitCode: 0,
          durationMs: 4000,
          summary: 'Built',
          reason: null,
        },
        {
          id: 'routes',
          status: 'skipped',
          command: null,
          exitCode: null,
          durationMs: 0,
          summary: 'No routes to check',
          reason: 'None were declared',
        },
      ],
      failedRoutes: [],
    },
    repair: { attempted: 0, repaired: false, restoredUnplannedFiles: [] },
    functionalChecks: [],
    coverage: [],
    plannedButUnchanged: [],
    limitations: [],
    usage: { calls: 2, inputTokens: null, outputTokens: 40, costUsd: null },
    ...overrides,
  };
}

function job(overrides: Partial<EnhancementJob> = {}): EnhancementJob {
  return {
    id: 'job-1',
    projectId: 'project-1',
    planId: 'plan-1',
    kind: 'ENHANCEMENT',
    cancelRequested: false,
    status: 'RUNNING',
    stage: 'implementing',
    stages: [
      {
        stage: 'implementing',
        startedAt: new Date(Date.now() - 2_000).toISOString(),
        completedAt: null,
        detail: null,
      },
    ],
    instruction: 'Add login and a dashboard',
    result: null,
    error: null,
    runId: null,
    startedAt: new Date(Date.now() - 2_000).toISOString(),
    completedAt: null,
    createdAt: new Date(Date.now() - 3_000).toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function event(seq: number, message: string, type = 'stage.started'): ExecutionEvent {
  return {
    id: `event-${String(seq)}`,
    projectId: 'project-1',
    jobKind: 'ENHANCEMENT',
    jobId: 'job-1',
    seq,
    type,
    status: 'started',
    stage: 'implementing',
    agentId: null,
    message,
    data: null,
    createdAt: new Date().toISOString(),
  };
}

function finished(overrides: Partial<EnhancementResult> = {}): EnhancementJob {
  return job({ status: 'SUCCEEDED', stage: 'finished', runId: 'run-2', result: result(overrides) });
}

async function request(text = 'Add login and a dashboard'): Promise<void> {
  await userEvent.type(screen.getByLabelText(/what should change/i), text);
}

async function submit(): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name: /plan this change/i }));
}

function renderTab(): void {
  renderWithProviders(<EnhanceTab />, { router: true });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('Image', StubImage);
  // jsdom has <dialog> but neither of the methods that open and close it.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
  workspace.isBuilding = false;
  vi.mocked(fetchCurrentEnhancementJob).mockResolvedValue(null);
  vi.mocked(fetchCurrentEditJob).mockResolvedValue(null);
  vi.mocked(fetchEnhancementEvents).mockResolvedValue([]);
  vi.mocked(fetchEnhancementJob).mockResolvedValue(job());
  vi.mocked(applyEnhancement).mockResolvedValue(job());
});

describe('the form rules', () => {
  it('accepts only plain web addresses, and a limited number of them', () => {
    expect(parseReferenceLinks('ftp://example.com').ok).toBe(false);
    expect(parseReferenceLinks('example.com').ok).toBe(false);
    expect(parseReferenceLinks('https://user:pw@example.com').ok).toBe(false);
    const many = Array.from({ length: 6 }, (_, i) => `https://a.com/${String(i)}`).join('\n');
    expect(parseReferenceLinks(many).ok).toBe(false);
    expect(parseReferenceLinks('https://a.com\n\nhttps://a.com')).toEqual({
      ok: true,
      urls: ['https://a.com/'],
    });
  });

  it('leaves the research choice to the server on Automatic', () => {
    expect(researchPayload('auto')).toEqual({});
    expect(researchPayload('on')).toEqual({ research: true });
    expect(researchPayload('off')).toEqual({ research: false });
  });

  it('leaves a request with no links exactly as it was typed', () => {
    expect(instructionWithLinks('Do this', [])).toBe('Do this');
  });

  it('keeps events in order and never repeats one', () => {
    const merged = mergeEnhancementEvents([event(2, 'b')], [event(1, 'a'), event(2, 'b')]);
    expect(merged.map((item) => item.seq)).toEqual([1, 2]);
  });
});

describe('the enhancement workflow', () => {
  it('waits for approval on a substantial plan, then starts it', async () => {
    vi.mocked(planEnhancement).mockResolvedValue(plan());
    renderTab();
    await request();
    await submit();

    expect(await screen.findByText('Adds sign-in and a protected dashboard.')).toBeInTheDocument();
    expect(screen.getByText(/no web search was run/i)).toBeInTheDocument();
    expect(applyEnhancement).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /approve and apply/i }));
    await waitFor(() => {
      expect(applyEnhancement).toHaveBeenCalledWith('project-1', 'plan-1');
    });
    expect(await screen.findByLabelText('Enhancement stages')).toBeInTheDocument();
  });

  it('discards a plan without starting anything', async () => {
    vi.mocked(planEnhancement).mockResolvedValue(plan());
    renderTab();
    await request();
    await submit();
    await userEvent.click(await screen.findByRole('button', { name: /discard/i }));

    expect(await screen.findByLabelText(/what should change/i)).toBeInTheDocument();
    expect(applyEnhancement).not.toHaveBeenCalled();
  });

  it('starts a small plan without asking', async () => {
    vi.mocked(planEnhancement).mockResolvedValue(plan({ substantial: false }));
    renderTab();
    await request();
    await submit();

    await waitFor(() => {
      expect(applyEnhancement).toHaveBeenCalledWith('project-1', 'plan-1');
    });
  });

  it('sends the research choice and carries links in the request', async () => {
    vi.mocked(planEnhancement).mockResolvedValue(plan());
    renderTab();
    await request();
    await userEvent.type(screen.getByLabelText(/reference links/i), 'https://example.com/a');
    await userEvent.click(screen.getByRole('radio', { name: /do not search/i }));
    await submit();

    await waitFor(() => {
      expect(planEnhancement).toHaveBeenCalledWith('project-1', {
        instruction:
          'Add login and a dashboard\n\nReference sites the owner pointed to:\nhttps://example.com/a',
        research: false,
      });
    });
  });

  it('refuses a bad link before asking the server', async () => {
    renderTab();
    await request();
    await userEvent.type(screen.getByLabelText(/reference links/i), 'not a link');
    await submit();

    expect(await screen.findByText(/is not a full address/i)).toBeInTheDocument();
    expect(planEnhancement).not.toHaveBeenCalled();
  });

  it('routes a request with an image to the path that reads images', async () => {
    vi.mocked(planEdit).mockReturnValue(new Promise(() => undefined));
    renderTab();
    await request('Make it match this mockup');
    await userEvent.upload(
      screen.getByLabelText(/attach an image/i),
      new File([new Uint8Array([137, 80, 78, 71])], 'mock.png', { type: 'image/png' }),
    );
    expect(await screen.findByText(/runs as a design edit/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/reference links/i)).not.toBeInTheDocument();
    await submit();

    await waitFor(() => {
      expect(planEdit).toHaveBeenCalledTimes(1);
    });
    expect(planEnhancement).not.toHaveBeenCalled();
  });

  it('shows the stages and events the server recorded, and no estimate', async () => {
    vi.mocked(fetchCurrentEnhancementJob).mockResolvedValue(job());
    vi.mocked(fetchEnhancementEvents).mockResolvedValue([
      event(1, 'Changing backend/src/auth.ts'),
      event(2, 'gemini answered', 'model.call'),
    ]);
    renderTab();

    expect(await screen.findByText('Changing backend/src/auth.ts')).toBeInTheDocument();
    expect(screen.queryByText('gemini answered')).not.toBeInTheDocument();
    expect(screen.queryByText(/%|minutes is normal|takes one to two/i)).not.toBeInTheDocument();
  });

  it('cancels through the server and says it is stopping', async () => {
    vi.mocked(fetchCurrentEnhancementJob).mockResolvedValue(job());
    vi.mocked(cancelEnhancement).mockResolvedValue(job({ cancelRequested: true }));
    renderTab();
    await userEvent.click(await screen.findByRole('button', { name: /^cancel$/i }));

    await waitFor(() => {
      expect(cancelEnhancement).toHaveBeenCalledWith('project-1', 'job-1');
    });
    expect(await screen.findByText(/stopping at the next safe point/i)).toBeInTheDocument();
  });

  it('never draws a skipped check as passed, or unknown usage as zero', async () => {
    vi.mocked(fetchEnhancementJob).mockResolvedValue(finished());
    vi.mocked(fetchCurrentEnhancementJob).mockResolvedValue(finished());
    renderTab();
    await userEvent.click(await screen.findByRole('button', { name: /view result/i }));

    const skipped = (await screen.findByText('routes')).closest('li');
    expect(skipped).toHaveAttribute('data-status', 'SKIPPED');
    expect(skipped).toHaveTextContent(/skipped/i);
    expect(screen.getByText(/unknown in · 40 out · cost unknown/)).toBeInTheDocument();
    expect(screen.getByText('export const auth = true;', { exact: false })).toBeInTheDocument();
  });

  it('reverts only after confirmation, and reports the new version', async () => {
    vi.mocked(fetchEnhancementJob).mockResolvedValue(finished());
    vi.mocked(fetchCurrentEnhancementJob).mockResolvedValue(finished());
    vi.mocked(revertEnhancement).mockResolvedValue({ runId: 'run-3', restoredRunId: 'run-1' });
    renderTab();
    await userEvent.click(await screen.findByRole('button', { name: /view result/i }));
    await userEvent.click(await screen.findByRole('button', { name: /revert this change/i }));

    expect(revertEnhancement).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /^revert$/i }));
    await waitFor(() => {
      expect(revertEnhancement).toHaveBeenCalledWith('project-1', 'job-1');
    });
    expect(await screen.findByText(/as a new version, run run-3/i)).toBeInTheDocument();
  });

  it('offers no revert for a change that was never applied', async () => {
    const rejected = job({
      status: 'REJECTED',
      stage: 'finished',
      result: result({
        status: 'rejected',
        runId: null,
        rolledBack: true,
        outcome: 'The build failed, so the change was thrown away.',
      }),
    });
    vi.mocked(fetchEnhancementJob).mockResolvedValue(rejected);
    vi.mocked(fetchCurrentEnhancementJob).mockResolvedValue(rejected);
    renderTab();
    await userEvent.click(await screen.findByRole('button', { name: /view result/i }));

    expect(await screen.findByText(/your project is unchanged/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /revert this change/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /open the updated app/i })).not.toBeInTheDocument();
  });

  it('will not start while a build is running', () => {
    workspace.isBuilding = true;
    renderTab();
    expect(screen.getByText(/a build is running/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/what should change/i)).not.toBeInTheDocument();
  });
});
