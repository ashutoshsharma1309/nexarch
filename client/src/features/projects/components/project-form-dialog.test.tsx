/**
 * Creating and renaming a project, which is the one form standing between a
 * prompt and a project to put it in.
 *
 * Two things go wrong quietly here. A name that is only spaces passes the
 * "is it empty" test a reader would apply but produces a project with a
 * blank title and an empty slug — so the guard has to be on the trimmed
 * value in both places that can submit, the button and the form itself.
 * And the fields are seeded from props by an effect, so reopening the dialog
 * on a different project has to reseed them: a rename dialog still holding
 * the previous project's name renames the wrong thing on one click.
 *
 * Pure props — no providers, no services. The dialog owns the draft and
 * hands the parent a trimmed result; everything else is the parent's.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { ProjectFormDialog } from './project-form-dialog';
import type { ProjectFormValues } from './project-form-dialog';

/**
 * jsdom declares HTMLDialogElement but implements neither `showModal` nor
 * `close`, so the Dialog's mount effect throws before a single field is
 * rendered. These two stand in for exactly what the component depends on —
 * the `open` state it reads back to decide whether to show or close — and
 * nothing more. The focus trap, the backdrop and Escape-to-close are the
 * browser's, and are not what these tests are about.
 */
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
  };
});

function nameField(): HTMLElement {
  return screen.getByLabelText('Name');
}

function descriptionField(): HTMLElement {
  return screen.getByLabelText('Description');
}

/** The form element itself, for the submit paths that bypass the button. */
function form(): HTMLFormElement {
  const element = screen
    .getByRole('button', { name: /create project|save changes/i })
    .closest('form');
  if (!(element instanceof HTMLFormElement)) throw new Error('the dialog rendered no form');
  return element;
}

describe('ProjectFormDialog', () => {
  it('refuses a name that is only whitespace, by the button and by the form', async () => {
    const onSubmit = vi.fn<(values: ProjectFormValues) => void>();
    render(<ProjectFormDialog open mode="create" onSubmit={onSubmit} onClose={() => undefined} />);

    await userEvent.type(nameField(), '   ');

    // The button is the visible half of the guard.
    expect(screen.getByRole('button', { name: /create project/i })).toBeDisabled();

    // And the form is the half that matters: Enter in a text input submits
    // the form directly, so a check that lives only on the button lets a
    // blank-named project through.
    fireEvent.submit(form());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('trims the name and the description before handing them over', async () => {
    const onSubmit = vi.fn<(values: ProjectFormValues) => void>();
    render(<ProjectFormDialog open mode="create" onSubmit={onSubmit} onClose={() => undefined} />);

    await userEvent.type(nameField(), '  Hospital Management  ');
    await userEvent.type(descriptionField(), '  Wards, staff and rotas  ');
    await userEvent.click(screen.getByRole('button', { name: /create project/i }));

    // The name becomes the project's slug and the heading on every export,
    // so the padding cannot survive this call.
    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Hospital Management',
      description: 'Wards, staff and rotas',
    });
  });

  it('submits an empty description as empty rather than refusing it', async () => {
    const onSubmit = vi.fn<(values: ProjectFormValues) => void>();
    render(<ProjectFormDialog open mode="create" onSubmit={onSubmit} onClose={() => undefined} />);

    await userEvent.type(nameField(), 'Clinic');
    await userEvent.click(screen.getByRole('button', { name: /create project/i }));

    expect(onSubmit).toHaveBeenCalledWith({ name: 'Clinic', description: '' });
  });

  it('reseeds both fields when it is reopened on a different project', async () => {
    const onSubmit = vi.fn<(values: ProjectFormValues) => void>();
    const view = render(
      <ProjectFormDialog
        open
        mode="rename"
        initialValues={{ name: 'Shop', description: 'A shop' }}
        onSubmit={onSubmit}
        onClose={() => undefined}
      />,
    );

    expect(nameField()).toHaveValue('Shop');
    expect(descriptionField()).toHaveValue('A shop');

    view.rerender(
      <ProjectFormDialog
        open={false}
        mode="rename"
        initialValues={{ name: 'Shop', description: 'A shop' }}
        onSubmit={onSubmit}
        onClose={() => undefined}
      />,
    );
    view.rerender(
      <ProjectFormDialog
        open
        mode="rename"
        initialValues={{ name: 'Clinic', description: 'A clinic' }}
        onSubmit={onSubmit}
        onClose={() => undefined}
      />,
    );

    // Still holding "Shop" here is how a rename renames the wrong project:
    // the dialog says Clinic in its title and Shop in its only field.
    expect(nameField()).toHaveValue('Clinic');
    expect(descriptionField()).toHaveValue('A clinic');

    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect(onSubmit).toHaveBeenCalledWith({ name: 'Clinic', description: 'A clinic' });
  });

  /** A background refetch of the project list must not discard typing. */
  it('keeps what the user has typed when the parent re-renders', async () => {
    const onSubmit = vi.fn<(values: ProjectFormValues) => void>();
    const view = render(
      <ProjectFormDialog
        open
        mode="rename"
        initialValues={{ name: 'Shop', description: 'A shop' }}
        onSubmit={onSubmit}
        onClose={() => undefined}
      />,
    );

    await userEvent.clear(nameField());
    await userEvent.type(nameField(), 'Shop v2');

    // The same values, a new object — exactly what an unrelated re-render of
    // the parent produces.
    view.rerender(
      <ProjectFormDialog
        open
        mode="rename"
        initialValues={{ name: 'Shop', description: 'A shop' }}
        onSubmit={onSubmit}
        onClose={() => undefined}
      />,
    );

    expect(nameField()).toHaveValue('Shop v2');
  });

  /** A live submit button during the request would create a second project. */
  it('does not accept a second submission while the first is in flight', () => {
    const onSubmit = vi.fn<(values: ProjectFormValues) => void>();
    render(
      <ProjectFormDialog
        open
        mode="create"
        loading
        initialValues={{ name: 'Clinic', description: '' }}
        onSubmit={onSubmit}
        onClose={() => undefined}
      />,
    );

    expect(screen.getByRole('button', { name: /create project/i })).toBeDisabled();
  });
});
