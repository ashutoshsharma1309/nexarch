/**
 * The progress surface every build is read through.
 *
 * This component had no test, and it is the only place the eight stages'
 * real state is shown. The failure that matters here is not a crash — it is
 * a row that overstates what happened: a deterministic fallback drawn with
 * the AI badge, a failed stage showing no reason, a skipped stage that looks
 * like a passing one, a pending stage wearing the tick. Each of those turns
 * "this part was never done" into "this part is fine", which is exactly the
 * claim a reader cannot check for themselves.
 *
 * Pure props, no providers: the component takes the server's stages and
 * renders them, so anything mocked here would be mocking the thing under
 * test. Assertions go through the `data-stage`/`data-status` attributes the
 * component already exposes for this purpose.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StageList } from './stage-list';
import type { PipelineStage, PipelineStageId } from '@/shared/types/api';

function stage(overrides: Partial<PipelineStage> & { id: PipelineStageId }): PipelineStage {
  return {
    label: 'Requirement Analysis',
    status: 'pending',
    engine: 'ai',
    agentId: 'requirement-analyst',
    startedAt: null,
    completedAt: null,
    durationMs: null,
    summary: null,
    error: null,
    degraded: false,
    ...overrides,
  };
}

/**
 * One stage's row. The attribute is the component's own contract with its
 * tests, and it survives restyling in a way that reading the icons does not.
 */
function row(container: HTMLElement, id: PipelineStageId): HTMLElement {
  const element = container.querySelector(`[data-stage="${id}"]`);
  if (!(element instanceof HTMLElement)) throw new Error(`no row rendered for stage "${id}"`);
  return element;
}

/** The success-coloured tick, which is the only thing that means "done". */
function hasDoneTick(element: HTMLElement): boolean {
  return element.querySelector('.text-success') !== null;
}

describe('StageList', () => {
  it('lists every stage the run reports, with the status the server gave it', () => {
    const { container } = render(
      <StageList
        stages={[
          stage({ id: 'analysis', status: 'completed' }),
          stage({ id: 'architecture', label: 'System Architecture', status: 'running' }),
          stage({ id: 'database', label: 'Database Design', status: 'pending' }),
        ]}
      />,
    );

    expect(screen.getByRole('list', { name: 'Pipeline stages' })).toBeInTheDocument();
    expect(row(container, 'analysis')).toHaveAttribute('data-status', 'completed');
    expect(row(container, 'architecture')).toHaveAttribute('data-status', 'running');
    expect(row(container, 'database')).toHaveAttribute('data-status', 'pending');
  });

  it('marks a degraded stage as a fallback and takes the AI badge off it', () => {
    const { container } = render(
      <StageList
        stages={[
          stage({ id: 'analysis', status: 'completed', engine: 'ai', degraded: true }),
          stage({
            id: 'architecture',
            label: 'System Architecture',
            status: 'completed',
            engine: 'ai',
          }),
        ]}
      />,
    );

    // A degraded stage is the deterministic template standing in for a model
    // call that failed. Badging it "AI" would present a canned answer as a
    // reasoned one — the reader has no other way to tell them apart.
    const fallback = row(container, 'analysis');
    expect(within(fallback).getByText('fallback')).toBeInTheDocument();
    expect(within(fallback).queryByText('AI')).toBeNull();

    // And the badge still means something: a real AI stage keeps it.
    const genuine = row(container, 'architecture');
    expect(within(genuine).getByText('AI')).toBeInTheDocument();
    expect(within(genuine).queryByText('fallback')).toBeNull();
  });

  it('never badges a deterministic stage as AI', () => {
    const { container } = render(
      <StageList
        stages={[
          stage({
            id: 'dependencies',
            label: 'Dependency Graph',
            status: 'completed',
            engine: 'deterministic',
          }),
        ]}
      />,
    );

    expect(within(row(container, 'dependencies')).queryByText('AI')).toBeNull();
  });

  it('shows a failed stage’s error on the row that failed', () => {
    const { container } = render(
      <StageList
        stages={[
          stage({ id: 'analysis', status: 'completed', summary: '6 modules' }),
          stage({
            id: 'backend',
            label: 'Backend Generation',
            status: 'failed',
            error: 'the model returned no files',
          }),
        ]}
      />,
    );

    const failed = row(container, 'backend');
    expect(failed).toHaveAttribute('data-status', 'failed');
    // Beside the stage, not in a banner at the bottom: which stage broke is
    // half of what the error means.
    expect(within(failed).getByText('the model returned no files')).toBeInTheDocument();
    expect(hasDoneTick(failed)).toBe(false);
  });

  it('reads a skipped stage as skipped rather than as a pass', () => {
    const { container } = render(
      <StageList
        stages={[
          stage({ id: 'analysis', status: 'completed', durationMs: 2_400 }),
          stage({ id: 'security', label: 'Security Review', status: 'skipped' }),
        ]}
      />,
    );

    const skipped = row(container, 'security');
    expect(skipped).toHaveAttribute('data-status', 'skipped');
    // "Security Review" with a tick beside it says the review passed. It did
    // not run at all, and those are not the same project.
    expect(hasDoneTick(skipped)).toBe(false);
    expect(hasDoneTick(row(container, 'analysis'))).toBe(true);
  });

  it('does not present a pending stage as done', () => {
    const { container } = render(
      <StageList
        stages={[
          stage({ id: 'analysis', status: 'completed', durationMs: 2_400, summary: '6 modules' }),
          stage({ id: 'frontend', label: 'Frontend Generation', status: 'pending' }),
        ]}
      />,
    );

    const pending = row(container, 'frontend');
    expect(pending).toHaveAttribute('data-status', 'pending');
    expect(hasDoneTick(pending)).toBe(false);
    // Nothing has happened yet, so there is no duration to show — a stage
    // with a time against it has run.
    expect(pending).toHaveTextContent('Frontend Generation');
    expect(pending.textContent).not.toMatch(/\ds|ms/);
  });

  it('renders the durations the server measured, and nothing where it measured none', () => {
    const { container } = render(
      <StageList
        stages={[
          stage({ id: 'analysis', status: 'completed', durationMs: 940 }),
          stage({
            id: 'database',
            label: 'Database Design',
            status: 'completed',
            durationMs: 2_400,
          }),
          stage({ id: 'frontend', label: 'Frontend Generation', status: 'running' }),
        ]}
      />,
    );

    // Sub-second work reads in milliseconds; anything longer in seconds.
    expect(within(row(container, 'analysis')).getByText('940ms')).toBeInTheDocument();
    expect(within(row(container, 'database')).getByText('2.4s')).toBeInTheDocument();
    // A running stage has no duration yet, and inventing one would be the
    // percentage this component deliberately does not have.
    expect(row(container, 'frontend').textContent).not.toMatch(/\d+(\.\d+)?(ms|s)/);
  });

  it('renders an empty list for a run with no stages yet', () => {
    render(<StageList stages={[]} />);

    expect(screen.getByRole('list', { name: 'Pipeline stages' })).toBeEmptyDOMElement();
  });
});
