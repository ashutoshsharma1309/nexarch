/**
 * Three ways this panel could lie, pinned shut.
 *
 * An edit is the one flow here that both reads an image and rewrites files,
 * so the failure modes that matter are not crashes — they are plausible
 * screens that overstate what happened. A rejected image that says "upload
 * failed" hides the limit the server named; a plan that quietly shows empty
 * style fields implies an image was read when none was; and a SKIPPED check
 * drawn like a passing one turns "lint never ran" into "lint passed".
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiClientError } from '@/shared/services/api-client';
import { EditPanel } from './edit-panel';
import { EditPlanReview } from './edit-plan-review';
import { EditResultView } from './edit-result';
import type {
  CheckStatus,
  EditPlan,
  EditResult,
  SiteDesignView,
  VisualReading,
} from '@/shared/types/api';

const planEdit = vi.hoisted(() => vi.fn());
vi.mock('@/shared/services/project-editor.service', () => ({
  planEdit,
  fetchEditPlan: vi.fn(),
  applyEdit: vi.fn(),
}));

/**
 * jsdom has a FileReader but never loads an <img>, so `onload` would never
 * fire and the attachment would hang. The stub stands in for the browser's
 * decoder and nothing else.
 */
class StubImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 1280;
  naturalHeight = 720;
  set src(_value: string) {
    setTimeout(() => {
      this.onload?.();
    }, 0);
  }
}

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

function plan(reading: VisualReading): EditPlan {
  return {
    id: 'plan-1',
    projectId: 'project-1',
    basedOnRunId: 'run-1',
    instruction: 'Make the hero warmer and put the menu first',
    image: null,
    reading,
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

function result(checks: { name: string; status: CheckStatus; detail: string }[]): EditResult {
  return {
    planId: 'plan-1',
    projectId: 'project-1',
    status: 'applied',
    runId: 'run-2',
    changedFiles: [],
    unchangedFileCount: 142,
    validation: { checks, startedUp: true, frontendUrl: null, backendUrl: null },
    outcome: 'The edit built, type-checked and started, so it was kept.',
    rolledBack: false,
    completedAt: new Date().toISOString(),
  };
}

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <EditPanel projectId="project-1" currentDesign={design('#2f6f4f')} onOpenPreview={vi.fn()} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal('Image', StubImage);
  planEdit.mockReset();
});

describe('EditPanel', () => {
  it("shows the server's refusal of an image word for word", async () => {
    const refusal =
      'The image is 5.4 MB; the limit is 4 MB. Export it smaller or screenshot a region.';
    planEdit.mockRejectedValue(new ApiClientError('BAD_REQUEST', refusal, { status: 400 }));

    renderPanel();
    await userEvent.click(screen.getByRole('button', { name: /modify this project/i }));

    const file = new File([new Uint8Array([137, 80, 78, 71])], 'reference.png', {
      type: 'image/png',
    });
    await userEvent.upload(screen.getByLabelText(/attach an image/i), file);
    await screen.findByText('reference.png');

    await userEvent.type(
      screen.getByLabelText(/what should change/i),
      'Use the orange from this screenshot',
    );
    await userEvent.click(screen.getByRole('button', { name: /plan this edit/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(refusal);
    });
  });
});

describe('EditPlanReview', () => {
  it('never claims an image was analysed when none was read', () => {
    render(
      <EditPlanReview
        plan={plan({ ...UNREAD, unavailableReason: 'The vision provider timed out.' })}
        applying={false}
        onApply={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );

    expect(screen.getByText('No image was read')).toBeInTheDocument();
    expect(screen.getByText('The vision provider timed out.')).toBeInTheDocument();
    expect(screen.queryByText('What the image showed')).not.toBeInTheDocument();
    expect(screen.queryByText(/read by/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/palette read from the image/i)).not.toBeInTheDocument();
  });
});

describe('EditResultView', () => {
  it('keeps a skipped check distinct from a passing one', () => {
    render(
      <EditResultView
        plan={plan(UNREAD)}
        result={result([
          { name: 'build', status: 'PASS', detail: 'npm run build · exit 0' },
          { name: 'lint', status: 'SKIPPED', detail: 'no lint script in package.json' },
        ])}
        currentDesign={design('#2f6f4f')}
        designUnavailableReason="unused in this test"
        onOpenPreview={vi.fn()}
        onStartAnother={vi.fn()}
      />,
    );

    const checks = screen.getByRole('list', { name: /edit validation checks/i });
    const [build, lint] = [...checks.querySelectorAll('li')];
    if (!build || !lint) throw new Error('expected a row per check');

    expect(build).toHaveAttribute('data-status', 'PASS');
    expect(build).toHaveTextContent('passed');

    expect(lint).toHaveAttribute('data-status', 'SKIPPED');
    expect(lint).toHaveTextContent('skipped');
    expect(lint).toHaveTextContent('never ran — this is not a pass');
    expect(lint.textContent).not.toMatch(/passed/);
    // The detail carries the evidence: the command, or why there was none.
    expect(lint).toHaveTextContent('no lint script in package.json');
  });
});
