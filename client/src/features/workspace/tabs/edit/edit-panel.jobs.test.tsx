/**
 * An edit that outlives the request that started it, from the panel's side.
 *
 * Applying used to be one long request, so the panel could treat "my call
 * returned" as "the edit is over". Now the work runs on the server and this
 * panel is a window onto a job, which opens a new set of ways to mislead
 * someone about their own project: inventing progress instead of showing the
 * job's, looking idle after a reload while an edit is halfway through and
 * inviting a second one, or reporting a refused edit as a success.
 *
 * So these tests follow the journeys rather than the component's internals.
 * The service module is mocked at the import boundary, the same way the rest
 * of this suite mocks it, and no polling interval is ever asserted: where a
 * test needs the next poll it waits for the screen to change, which is the
 * thing that has to keep working when the backoff is retuned.
 *
 * On timers: these tests run on the real clock. Testing Library's async
 * wrapper — every `await user.…` and every `waitFor` goes through it — drains
 * the microtask queue with a `setTimeout` it only winds itself for Jest's
 * fake timers, so under Vitest's it waits on a clock nobody turns and the
 * test hangs. The schedule itself is covered where no DOM interaction is
 * involved, in `use-project-edits.test.tsx`, under fake timers.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UserEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiClientError } from '@/shared/services/api-client';
import {
  applyEdit,
  fetchCurrentEditJob,
  fetchEditJob,
  fetchEditPlan,
  planEdit,
} from '@/shared/services/project-editor.service';
import { EditPanel } from './edit-panel';
import type {
  CheckStatus,
  EditJob,
  EditPlan,
  EditResult,
  EditStageRecord,
  SiteDesignView,
  VisualReading,
} from '@/shared/types/api';

vi.mock('@/shared/services/project-editor.service', () => ({
  planEdit: vi.fn(),
  fetchEditPlan: vi.fn(),
  applyEdit: vi.fn(),
  fetchEditJob: vi.fn(),
  fetchCurrentEditJob: vi.fn(),
}));

const mockedPlanEdit = vi.mocked(planEdit);
const mockedFetchEditPlan = vi.mocked(fetchEditPlan);
const mockedApplyEdit = vi.mocked(applyEdit);
const mockedFetchEditJob = vi.mocked(fetchEditJob);
const mockedFetchCurrentEditJob = vi.mocked(fetchCurrentEditJob);

/** The stage lines the panel renders, as a user reads them. */
const REBUILDING = 'Rebuilding the project with the edit';
const VALIDATING = 'Installing, building, type-checking and starting it';
const DECIDING = 'Deciding whether to keep the edit';

/**
 * Long enough for a poll the panel schedules itself to land, short enough
 * that a hang is still a failure rather than a stuck suite. It is not the
 * interval: no test here knows what that is.
 */
const NEXT_POLL_MS = 6_000;

const UNREAD: VisualReading = {
  available: false,
  unavailableReason: 'No image was attached.',
  layout: '',
  palette: [],
  typography: '',
  spacing: '',
  components: [],
  mood: '',
  notes: '',
  model: null,
};

function design(accent: string): SiteDesignView {
  return {
    brand: 'Cafe Nova',
    tagline: 'Coffee, all day',
    theme: {
      mode: 'light',
      temperature: 'warm',
      corners: 'soft',
      fontId: 'inter',
      palette: {
        canvas: '#ffffff',
        surface: '#faf7f2',
        fg: '#111111',
        accent,
        accentFg: '#ffffff',
      },
    },
    sections: [
      { kind: 'hero', id: 'hero', navLabel: 'Home' },
      { kind: 'menu', id: 'menu', navLabel: 'Menu' },
    ],
    footerNote: '© Cafe Nova',
  };
}

const INSTRUCTION = 'Make the hero warmer and put the menu first';

function plan(): EditPlan {
  return {
    id: 'plan-1',
    projectId: 'project-1',
    basedOnRunId: 'run-1',
    instruction: INSTRUCTION,
    image: null,
    reading: UNREAD,
    summary: 'This edit changes the accent and reorders the sections.',
    changes: [{ path: 'frontend/src/theme.css', reason: '4 lines added, 2 removed' }],
    preserved: [{ label: 'Backend', fileCount: 79 }],
    impact: {
      direct: ['frontend/src/theme.css'],
      dependents: [],
      tests: [],
      graphUnavailable: false,
      graphUnavailableReason: null,
    },
    risks: [],
    validationPlan: ['Install and build the edited project'],
    design: design('#e2711d'),
    status: 'planned',
    createdAt: new Date().toISOString(),
  };
}

/**
 * Timestamps are built backwards from the moment the test runs, so a job in
 * these fixtures is one that started seconds ago. How long it has been
 * running is what decides how soon the panel asks again.
 */
function ago(seconds: number): string {
  return new Date(Date.now() - seconds * 1_000).toISOString();
}

function stage(
  name: EditStageRecord['stage'],
  startedSecondsAgo: number,
  completedSecondsAgo: number | null,
): EditStageRecord {
  return {
    stage: name,
    startedAt: ago(startedSecondsAgo),
    completedAt: completedSecondsAgo === null ? null : ago(completedSecondsAgo),
    detail: null,
  };
}

function job(overrides: Partial<EditJob> = {}): EditJob {
  return {
    id: 'job-1',
    projectId: 'project-1',
    planId: 'plan-1',
    status: 'RUNNING',
    stage: 'rebuilding',
    stages: [stage('queued', 4, 3), stage('rebuilding', 3, null)],
    instruction: INSTRUCTION,
    result: null,
    error: null,
    runId: null,
    startedAt: ago(4),
    completedAt: null,
    createdAt: ago(4),
    updatedAt: ago(0),
    ...overrides,
  };
}

/** The same job three seconds later: rebuilding measured, validating open. */
function validatingJob(): EditJob {
  return job({
    stage: 'validating',
    stages: [stage('queued', 4, 3), stage('rebuilding', 3, 0), stage('validating', 0, null)],
  });
}

function editResult(overrides: Partial<EditResult> = {}): EditResult {
  const checks: { name: string; status: CheckStatus; detail: string }[] = [
    { name: 'build', status: 'PASS', detail: 'npm run build · exit 0' },
    { name: 'lint', status: 'SKIPPED', detail: 'no lint script in package.json' },
  ];
  return {
    planId: 'plan-1',
    projectId: 'project-1',
    status: 'applied',
    runId: 'run-2',
    changedFiles: [
      {
        path: 'frontend/src/theme.css',
        addedLines: 4,
        removedLines: 2,
        hunks: [{ line: 12, removed: ['--accent: #2f6f4f;'], added: ['--accent: #e2711d;'] }],
      },
    ],
    unchangedFileCount: 142,
    validation: { checks, startedUp: true, frontendUrl: null, backendUrl: null },
    outcome: 'The edit built, type-checked and started, so it was kept.',
    rolledBack: false,
    completedAt: new Date().toISOString(),
    ...overrides,
  };
}

/** A promise the test settles itself, for the moments between two states. */
function deferred<T>(): { promise: Promise<T>; settle: (value: T) => void } {
  let settle: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    settle = (value) => {
      resolve(value);
    };
  });
  return { promise, settle };
}

function renderPanel(): { user: UserEvent } {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <EditPanel projectId="project-1" currentDesign={design('#2f6f4f')} onOpenPreview={vi.fn()} />
    </QueryClientProvider>,
  );
  return { user };
}

/** Compose an instruction, plan it, and stop at the review. */
async function reachReview(user: UserEvent): Promise<void> {
  await user.click(screen.getByRole('button', { name: /modify this project/i }));
  await user.type(screen.getByLabelText(/what should change/i), INSTRUCTION);
  await user.click(screen.getByRole('button', { name: /plan this edit/i }));
  await screen.findByRole('button', { name: /apply edit/i });
}

/** The stage list the panel shows while an edit is applying. */
function progressStages(): HTMLElement {
  return screen.getByRole('list');
}

beforeEach(() => {
  mockedPlanEdit.mockReset();
  mockedFetchEditPlan.mockReset();
  mockedApplyEdit.mockReset();
  mockedFetchEditJob.mockReset();
  mockedFetchCurrentEditJob.mockReset();

  mockedPlanEdit.mockResolvedValue(plan());
  mockedFetchEditPlan.mockResolvedValue(plan());
  // Most journeys start from a project with nothing running.
  mockedFetchCurrentEditJob.mockResolvedValue(null);
});

describe('applying an edit', () => {
  it("shows the job's own stages, and finds out about one the first poll did not have", async () => {
    mockedApplyEdit.mockResolvedValue(job({ status: 'QUEUED', stage: 'queued' }));
    mockedFetchEditJob.mockResolvedValueOnce(job()).mockResolvedValue(validatingJob());

    const { user } = renderPanel();
    await reachReview(user);
    await user.click(screen.getByRole('button', { name: /apply edit/i }));

    await waitFor(() => {
      expect(within(progressStages()).getByText(REBUILDING)).toBeInTheDocument();
    });
    // Nothing is invented ahead of the server: a stage it has not started is
    // not on the screen.
    expect(within(progressStages()).queryByText(VALIDATING)).not.toBeInTheDocument();

    // Nobody asks again — the panel does, on its own, and the screen moves
    // on with the job.
    await waitFor(
      () => {
        expect(within(progressStages()).getByText(VALIDATING)).toBeInTheDocument();
      },
      { timeout: NEXT_POLL_MS },
    );

    // The stage that finished keeps the duration the server measured, which
    // is the whole reason this list is the job's and not an animation.
    const rebuilt = progressStages().querySelector('li[data-stage="rebuilding"]');
    expect(rebuilt).toHaveAttribute('data-done', 'true');
    expect(rebuilt).toHaveTextContent('3s');
  }, 15_000); // default budget. It is the only wall-clock wait in the file worth paying. // One real poll has to land inside this test, so it gets more than the

  it('does not start a second edit from one click, or from two', async () => {
    const started = deferred<EditJob>();
    mockedApplyEdit.mockReturnValue(started.promise);
    mockedFetchEditJob.mockResolvedValue(job());

    const { user } = renderPanel();
    await reachReview(user);

    const applyButton = screen.getByRole('button', { name: /apply edit/i });
    await user.click(applyButton);

    // While the request is in flight the control is shut. A second apply is
    // not a wasted request: it is a race over the same baseline.
    await waitFor(() => {
      expect(applyButton).toBeDisabled();
    });
    await user.click(applyButton);
    await user.dblClick(applyButton);
    expect(mockedApplyEdit).toHaveBeenCalledTimes(1);

    started.settle(job({ status: 'QUEUED', stage: 'queued' }));
    await waitFor(() => {
      expect(within(progressStages()).getByText(REBUILDING)).toBeInTheDocument();
    });
  });

  it('reads back the server refusing a second edit, instead of dead-ending', async () => {
    const refusal =
      'An edit is already running for this project. Wait for it to finish before starting another.';
    mockedApplyEdit.mockRejectedValue(new ApiClientError('CONFLICT', refusal, { status: 409 }));

    const { user } = renderPanel();
    await reachReview(user);
    await user.click(screen.getByRole('button', { name: /apply edit/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(refusal);
    });
    // And the screen still has a way out, in both directions.
    expect(screen.getByRole('button', { name: /apply edit/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /discard/i })).toBeEnabled();
  });

  it('does not promise an untouched project when the request never got an answer', async () => {
    // No status: the request died on the network, which may well have been on
    // the way back from an apply that finished.
    mockedApplyEdit.mockRejectedValue(new Error('Network Error'));

    const { user } = renderPanel();
    await reachReview(user);
    await user.click(screen.getByRole('button', { name: /apply edit/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Network Error');
    expect(alert).toHaveTextContent(/cannot be told from here/);
    // The guarantee the server's own refusal earns, which this is not.
    expect(alert.textContent).not.toMatch(/left as it was/);
  });
});

describe('reopening a project mid-edit', () => {
  it('adopts the running job and shows its progress without a click', async () => {
    mockedFetchCurrentEditJob.mockResolvedValue(validatingJob());
    mockedFetchEditJob.mockResolvedValue(validatingJob());

    renderPanel();

    await waitFor(() => {
      expect(within(progressStages()).getByText(VALIDATING)).toBeInTheDocument();
    });
    // Nobody expanded the panel and nobody applied anything: the project was
    // asked what it was doing and it answered.
    expect(screen.getByRole('button', { name: /modify this project/i })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(mockedApplyEdit).not.toHaveBeenCalled();
    // An empty compose form is the duplicate-edit trap this exists to avoid.
    expect(screen.queryByLabelText(/what should change/i)).not.toBeInTheDocument();
  });

  it('leaves a finished edit finished rather than reopening a result from another session', async () => {
    mockedFetchCurrentEditJob.mockResolvedValue(
      job({
        status: 'SUCCEEDED',
        stage: 'finished',
        result: editResult(),
        runId: 'run-2',
        completedAt: new Date().toISOString(),
      }),
    );

    const { user } = renderPanel();
    await waitFor(() => {
      expect(mockedFetchCurrentEditJob).toHaveBeenCalled();
    });
    await user.click(screen.getByRole('button', { name: /modify this project/i }));

    expect(screen.getByLabelText(/what should change/i)).toBeInTheDocument();
    expect(mockedFetchEditJob).not.toHaveBeenCalled();
  });

  /**
   * A gap this panel still has, pinned here so it cannot widen unnoticed.
   *
   * Between adopting the running job and the first answer about it, the panel
   * holds a plan and no job — the same state as "reviewing a plan" — so it
   * offers "Apply edit" for an edit that is already running. The server
   * refuses the second apply, so nothing is corrupted, but on a slow first
   * read this is exactly the button the adoption exists to take away. When
   * that is fixed, this is the assertion to invert.
   */
  it('does not offer Apply while the adopted job is still being read', async () => {
    // The gap between adopting a job and its first answer used to render the
    // plan with an enabled Apply — inviting the duplicate that the whole job
    // model exists to prevent.
    mockedFetchCurrentEditJob.mockResolvedValue(validatingJob());
    mockedFetchEditJob.mockReturnValue(deferred<EditJob>().promise);

    renderPanel();

    await screen.findByLabelText(/reading the edit in progress/i);
    expect(screen.queryByRole('button', { name: /apply edit/i })).not.toBeInTheDocument();
  });
});

describe('how an edit ends', () => {
  /**
   * Apply, hold the first poll open so the progress view is on screen, then
   * let the job come back in the state under test. No clock involved: the
   * first read of the job is the test's to answer whenever it likes.
   */
  async function applyThenSettle(final: EditJob): Promise<UserEvent> {
    mockedApplyEdit.mockResolvedValue(job({ status: 'QUEUED', stage: 'queued' }));
    const firstPoll = deferred<EditJob>();
    mockedFetchEditJob.mockReturnValue(firstPoll.promise);

    const { user } = renderPanel();
    await reachReview(user);
    await user.click(screen.getByRole('button', { name: /apply edit/i }));
    await waitFor(() => {
      expect(screen.getByText('Queued')).toBeInTheDocument();
    });

    firstPoll.settle(final);
    await waitFor(() => {
      expect(screen.queryByText('Queued')).not.toBeInTheDocument();
    });
    return user;
  }

  it('SUCCEEDED shows what changed and what ran, with a skipped check still skipped', async () => {
    const user = await applyThenSettle(
      job({
        status: 'SUCCEEDED',
        stage: 'finished',
        result: editResult(),
        runId: 'run-2',
        completedAt: new Date().toISOString(),
      }),
    );

    expect(screen.getByText(/Applied — this is the project now/)).toBeInTheDocument();
    expect(screen.getByText(/recorded as run run-2/)).toBeInTheDocument();
    expect(screen.getByText('frontend/src/theme.css', { exact: false })).toBeInTheDocument();

    const checks = screen.getByRole('list', { name: /edit validation checks/i });
    const lint = checks.querySelector('li[data-check="lint"]');
    if (lint === null) throw new Error('expected a row for the lint check');
    // The property the result view is built around, reached through the job
    // this time rather than by rendering that view directly: a check that
    // never ran must not be able to pass for one that passed.
    expect(lint).toHaveAttribute('data-status', 'SKIPPED');
    expect(lint).toHaveTextContent('never ran — this is not a pass');
    expect(lint.textContent).not.toMatch(/passed/);

    // And the way on from a finished edit is a new one, not a second apply of
    // the plan that has already been applied.
    await user.click(screen.getByRole('button', { name: /make another edit/i }));
    expect(screen.getByLabelText(/what should change/i)).toBeInTheDocument();
    expect(screen.queryByText(/Applied — this is the project now/)).not.toBeInTheDocument();
  });

  it('REJECTED reads as an unchanged project, not as a success', async () => {
    await applyThenSettle(
      job({
        status: 'REJECTED',
        stage: 'finished',
        completedAt: new Date().toISOString(),
        result: editResult({
          status: 'rejected',
          runId: null,
          rolledBack: true,
          outcome: 'The edited project failed to build, so the edit was discarded.',
          validation: {
            checks: [
              { name: 'build', status: 'FAIL', detail: 'npm run build · exit 1' },
              { name: 'lint', status: 'SKIPPED', detail: 'the build failed first' },
            ],
            startedUp: false,
            frontendUrl: null,
            backendUrl: null,
          },
        }),
      }),
    );

    expect(screen.getByText(/Discarded — your project is unchanged/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing was written/)).toBeInTheDocument();
    expect(screen.getByText(/failed to build, so the edit was discarded/)).toBeInTheDocument();
    expect(screen.queryByText(/Applied — this is the project now/)).not.toBeInTheDocument();
    // A refusal is not an invitation to go and look at what was refused.
    expect(screen.queryByRole('button', { name: /open the updated app/i })).not.toBeInTheDocument();
  });

  /**
   * FAILED and INTERRUPTED carry their explanation in `job.error`, and this
   * panel renders no such thing: with no result and no running job it falls
   * back to the plan review, so the progress simply vanishes and "Apply edit"
   * is offered again with nothing said about what happened.
   *
   * The two tests below pin that, including the one part that is right —
   * neither ending is dressed up as a success — so the silence stays visible
   * in the suite until it is fixed. The `queryBy…` assertions on the error
   * text are the ones to invert then.
   */
  it('FAILED says why, and says the project was not changed', async () => {
    const reason = 'The provider was unreachable. The project was not changed.';
    await applyThenSettle(
      job({
        status: 'FAILED',
        stage: 'finished',
        error: reason,
        completedAt: new Date().toISOString(),
      }),
    );

    expect(screen.queryByText(/Applied — this is the project now/)).not.toBeInTheDocument();
    expect(screen.queryByText(REBUILDING)).not.toBeInTheDocument();
    // The reason reaches the reader, in an alert, and Apply is not offered
    // again as though nothing had happened.
    expect(screen.getByRole('alert')).toHaveTextContent(/could not be applied/i);
    expect(screen.getByText(reason)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /apply edit/i })).not.toBeInTheDocument();
  });

  it('INTERRUPTED says the server restarted and claims no outcome', async () => {
    const reason =
      'The server restarted while this edit was running. The edit was not applied — the project still has the files it had before it started — but check the project before editing again.';
    await applyThenSettle(
      job({
        status: 'INTERRUPTED',
        stage: 'validating',
        error: reason,
        completedAt: new Date().toISOString(),
      }),
    );

    expect(screen.queryByText(/Applied — this is the project now/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Discarded — your project is unchanged/)).not.toBeInTheDocument();
    // The row the durable table exists for finally reaches a reader: it says
    // what happened without claiming the edit either succeeded or failed.
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/interrupted/i);
    expect(alert).toHaveTextContent(/restarted/);
    expect(screen.queryByRole('button', { name: /apply edit/i })).not.toBeInTheDocument();
  });

  it('lets a dismissed outcome stay dismissed', async () => {
    // The outcome is adopted from the server here, which is the case that
    // broke: dismissing set the watched job back to null, the adoption effect
    // re-ran against the same still-cached row, and put the alert straight
    // back — leaving no way out of the panel but a page reload.
    const failed = job({
      status: 'FAILED',
      stage: 'finished',
      error: 'The provider was unreachable. The project was not changed.',
      completedAt: new Date().toISOString(),
    });
    mockedFetchCurrentEditJob.mockResolvedValue(failed);
    mockedFetchEditJob.mockResolvedValue(failed);

    const { user } = renderPanel();
    await user.click(screen.getByRole('button', { name: /modify this project/i }));
    await screen.findByRole('alert');

    await user.click(screen.getByRole('button', { name: /start again/i }));

    expect(await screen.findByLabelText(/what should change/i)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('losing contact while an edit runs', () => {
  it('keeps the progress already shown, and picks the job back up afterwards', async () => {
    mockedFetchCurrentEditJob.mockResolvedValue(validatingJob());
    mockedFetchEditJob.mockResolvedValueOnce(validatingJob());
    // Every poll after the first one fails, so the outage lasts as long as
    // this test wants rather than as long as one interval.
    mockedFetchEditJob.mockRejectedValue(new ApiClientError('NETWORK_ERROR', 'Network Error'));

    renderPanel();
    await waitFor(() => {
      expect(within(progressStages()).getByText(VALIDATING)).toBeInTheDocument();
    });

    await waitFor(
      () => {
        expect(mockedFetchEditJob.mock.calls.length).toBeGreaterThan(1);
      },
      { timeout: NEXT_POLL_MS },
    );

    // The important half: a dropped poll does not wipe the stages, and the
    // panel does not decide the edit succeeded, failed or went away.
    expect(within(progressStages()).getByText(REBUILDING)).toBeInTheDocument();
    expect(within(progressStages()).getByText(VALIDATING)).toBeInTheDocument();
    expect(screen.queryByText(/Applied — this is the project now/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Discarded — your project is unchanged/)).not.toBeInTheDocument();

    // The other half is missing, and is pinned here: nothing on screen says
    // the panel has lost contact. The spinner and the live region carry on
    // as though the stage being shown were current, which after an outage
    // it is only by luck. Invert this when a failed poll is reported.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    // Once the server answers again the panel catches up by itself, so a
    // blip is not something a user has to recover from by reloading.
    mockedFetchEditJob.mockReset();
    mockedFetchEditJob.mockResolvedValue(
      job({
        stage: 'deciding',
        stages: [
          stage('queued', 4, 3),
          stage('rebuilding', 3, 1),
          stage('validating', 1, 0),
          stage('deciding', 0, null),
        ],
      }),
    );
    await waitFor(
      () => {
        expect(within(progressStages()).getByText(DECIDING)).toBeInTheDocument();
      },
      { timeout: NEXT_POLL_MS },
    );
  }, 20_000); // recovers. // Two real polls have to land here: the one that fails and the one that
});
