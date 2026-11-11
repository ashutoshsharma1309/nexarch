/**
 * The drawing prints real figures, so it must never print an invented one: a
 * request in flight or a failed one is not "0 projects".
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { WorkspaceDrawing } from './workspace-drawing';

describe('WorkspaceDrawing', () => {
  it('dimensions the workspace with the figures it is given', () => {
    render(<WorkspaceDrawing total={1} active={1} lastChange="yesterday" />);

    expect(screen.getByText('1 project')).toBeInTheDocument();
    expect(screen.getByText('1 active')).toBeInTheDocument();
    expect(screen.getByText('last change yesterday')).toBeInTheDocument();
  });

  it('prints no number while the figures are unknown', () => {
    render(<WorkspaceDrawing total={null} active={null} lastChange={null} />);

    expect(screen.getByText('— projects')).toBeInTheDocument();
    expect(screen.queryByText('no changes recorded')).not.toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAccessibleName('Workspace figures are not available yet');
  });

  it('distinguishes an empty workspace from an unknown one', () => {
    render(<WorkspaceDrawing total={0} active={0} lastChange={null} />);

    expect(screen.getByText('0 projects')).toBeInTheDocument();
    expect(screen.getByText('no changes recorded')).toBeInTheDocument();
  });
});
