/**
 * Design-system component tests — the behavioral contracts, not pixels:
 * a loading button must be unclickable, badge variants must map to their
 * semantic classes, and an EmptyState's action must actually fire.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Badge } from './badge';
import { Button } from './button';
import { EmptyState } from './empty-state';

describe('Button', () => {
  it('fires onClick when enabled', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);

    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('is disabled and inert while loading', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );

    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    await user.click(button).catch(() => undefined);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('Button classes', () => {
  // tailwind-merge reads an unrecognised `text-*` as a colour. A size token it
  // does not know removes the variant's text colour without any error, and the
  // label renders the same colour as its own background.
  it.each([
    ['forge', 'text-on-ember'],
    ['primary', 'text-canvas'],
    ['danger', 'text-danger'],
  ] as const)('keeps the %s text colour at every size', (variant, colour) => {
    for (const size of ['sm', 'md', 'lg'] as const) {
      const { unmount } = render(
        <Button variant={variant} size={size}>
          Label
        </Button>,
      );
      expect(screen.getByRole('button', { name: 'Label' })).toHaveClass(colour);
      unmount();
    }
  });
});

describe('Badge', () => {
  it('applies the semantic variant class', () => {
    render(<Badge variant="danger">failed</Badge>);
    expect(screen.getByText('failed')).toHaveClass('text-danger');
  });

  it('defaults to the neutral variant', () => {
    render(<Badge>plain</Badge>);
    expect(screen.getByText('plain')).toHaveClass('text-fg-muted');
  });
});

describe('EmptyState', () => {
  it('renders title, description, and a working action', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(
      <EmptyState
        title="Nothing here"
        description="Generate something first."
        action={<Button onClick={onAction}>Go generate</Button>}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Nothing here' })).toBeInTheDocument();
    expect(screen.getByText('Generate something first.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Go generate' }));
    expect(onAction).toHaveBeenCalledOnce();
  });
});
