// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, onTestFinished } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import ConfirmDialog from '@/components/ConfirmDialog';

// useBodyScrollLock restores the scroll position on close; jsdom lacks scrollTo.
beforeAll(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterAll(() => vi.restoreAllMocks());
beforeEach(() => cleanup());

function renderDialog(onConfirm: () => void | Promise<unknown>, onCancel = vi.fn()) {
  render(
    <ConfirmDialog
      isOpen
      title="Remove Member"
      message="Are you sure?"
      onConfirm={onConfirm}
      onCancel={onCancel}
      confirmText="Remove"
      pendingText="Removing..."
      type="danger"
    />
  );
  return onCancel;
}

// An onConfirm that stays in flight until the test calls `finish`.
function deferredConfirm() {
  let finish!: () => void;
  const onConfirm = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  return { onConfirm, finish: () => act(async () => finish()) };
}

const button = (name: string | RegExp) => screen.getByRole('button', { name });
const backdrop = () => screen.getByRole('alertdialog').parentElement!;

describe('ConfirmDialog — accessible name and description', () => {
  // regression: the alertdialog had no aria-labelledby / aria-describedby, so
  // once focus moved in to Cancel a screen reader announced "alert dialog,
  // Cancel, button" without the title or the message.
  it('regression: is named by its title and described by its message', () => {
    renderDialog(vi.fn());

    const dialog = screen.getByRole('alertdialog', { name: 'Remove Member' });

    expect(dialog).toHaveAccessibleDescription('Are you sure?');
  });

  // A fixed id would point the second dialog's aria-labelledby at the first
  // one's title.
  it('gives each of two dialogs open at once its own name and description', () => {
    render(
      <>
        <ConfirmDialog
          isOpen
          title="Discard changes"
          message="Your edits will be lost."
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />
        <ConfirmDialog
          isOpen
          title="Delete Wishlist"
          message="This action cannot be undone."
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />
      </>
    );

    expect(
      screen.getByRole('alertdialog', { name: 'Discard changes' })
    ).toHaveAccessibleDescription('Your edits will be lost.');
    expect(
      screen.getByRole('alertdialog', { name: 'Delete Wishlist' })
    ).toHaveAccessibleDescription('This action cannot be undone.');
  });
});

describe('ConfirmDialog — an action that returns nothing', () => {
  it('calls onConfirm and never shows a pending state', () => {
    const onConfirm = vi.fn();
    renderDialog(onConfirm);

    fireEvent.click(button('Remove'));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(button('Remove')).toBeEnabled();
    expect(button('Cancel')).toBeEnabled();
  });

  it('closes on Escape and on a backdrop click', () => {
    const onCancel = renderDialog(vi.fn());

    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(backdrop());

    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});

describe('ConfirmDialog — an action that returns a promise', () => {
  it('shows progress and disables both buttons until it settles', async () => {
    const { onConfirm, finish } = deferredConfirm();
    renderDialog(onConfirm);

    fireEvent.click(button('Remove'));

    expect(button('Removing...')).toBeDisabled();
    expect(button('Cancel')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();

    await finish();
    await waitFor(() => expect(button('Remove')).toBeEnabled());
    expect(button('Cancel')).toBeEnabled();
  });

  // regression: the dialog had no pending state and kept calling onConfirm, so
  // a double click on Remove Member sent two DELETEs and the second one's 404
  // toasted "Failed to remove member" right after the success.
  it('regression: does not call onConfirm again on a second click while it runs', async () => {
    const { onConfirm, finish } = deferredConfirm();
    renderDialog(onConfirm);

    fireEvent.click(button('Remove'));
    fireEvent.click(button('Removing...'));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    await finish();
  });

  // regression: as above, for two clicks landing before React re-renders the
  // button as disabled.
  it('regression: does not call onConfirm again on a second click before it re-renders', async () => {
    const { onConfirm, finish } = deferredConfirm();
    renderDialog(onConfirm);

    const confirm = button('Remove');
    act(() => {
      confirm.click();
      confirm.click();
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);

    await finish();
  });

  it('ignores Escape and backdrop clicks while it runs, without passing Escape on', async () => {
    const { onConfirm, finish } = deferredConfirm();
    const onCancel = renderDialog(onConfirm);
    // A parent modal (BaseModal) listens for Escape on the document too.
    const parentEscape = vi.fn();
    document.addEventListener('keydown', parentEscape);
    onTestFinished(() => document.removeEventListener('keydown', parentEscape));

    fireEvent.click(button('Remove'));
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(backdrop());

    expect(onCancel).not.toHaveBeenCalled();
    expect(parentEscape).not.toHaveBeenCalled();

    await finish();
    // Settled: the dialog can be dismissed again.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('lets the user confirm again once it has settled', async () => {
    const { onConfirm, finish } = deferredConfirm();
    renderDialog(onConfirm);

    fireEvent.click(button('Remove'));
    await finish();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));

    expect(onConfirm).toHaveBeenCalledTimes(2);
    await finish();
  });
});

/** A page with a button that opens the dialog, and another one behind it. */
function DialogPage() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open</button>
      <button>Behind</button>
      <ConfirmDialog
        isOpen={open}
        title="Remove Member"
        message="Are you sure?"
        onConfirm={() => setOpen(false)}
        onCancel={() => setOpen(false)}
        confirmText="Remove"
        pendingText="Removing..."
        type="danger"
      />
    </>
  );
}

describe('ConfirmDialog — keyboard focus', () => {
  it('moves focus to Cancel when it opens', async () => {
    const user = userEvent.setup();
    render(<DialogPage />);

    await user.click(button('Open'));

    expect(button('Cancel')).toHaveFocus();
  });

  it('keeps Tab and Shift+Tab inside, wrapping at both ends', async () => {
    const user = userEvent.setup();
    render(<DialogPage />);
    await user.click(button('Open'));

    await user.tab();
    expect(button('Remove')).toHaveFocus();
    await user.tab();
    expect(button('Cancel')).toHaveFocus();
    await user.tab({ shift: true });
    expect(button('Remove')).toHaveFocus();
    await user.tab({ shift: true });
    expect(button('Cancel')).toHaveFocus();
  });

  it('brings focus back inside when it has dropped to the page', async () => {
    const user = userEvent.setup();
    render(<DialogPage />);
    await user.click(button('Open'));

    act(() => (document.activeElement as HTMLElement).blur());
    await user.tab();
    expect(button('Cancel')).toHaveFocus();

    act(() => (document.activeElement as HTMLElement).blur());
    await user.tab({ shift: true });
    expect(button('Remove')).toHaveFocus();
  });

  it('returns focus to the button that opened it when it closes', async () => {
    const user = userEvent.setup();
    render(<DialogPage />);

    await user.click(button('Open'));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(button('Open')).toHaveFocus();

    await user.click(button('Open'));
    await user.click(button('Cancel'));
    expect(button('Open')).toHaveFocus();
  });

  it('leaves focus alone on close when its opener has gone', async () => {
    const user = userEvent.setup();
    function OpenerGoes() {
      const [open, setOpen] = useState(false);
      return (
        <>
          {!open && <button onClick={() => setOpen(true)}>Open</button>}
          <ConfirmDialog
            isOpen={open}
            title="Remove Member"
            message="Are you sure?"
            onConfirm={vi.fn()}
            onCancel={() => setOpen(false)}
          />
        </>
      );
    }
    render(<OpenerGoes />);

    await user.click(button('Open'));
    await user.click(button('Cancel'));

    expect(document.body).toHaveFocus();
  });

  // regression: WIS-89 disables both buttons while the action runs, and
  // disabling the focused confirm button dropped focus to <body>, behind the
  // backdrop, where the next Tab started from the top of the page.
  it('regression: holds focus on itself while its action runs, and lets Tab back in once it settles', async () => {
    const user = userEvent.setup();
    const { onConfirm, finish } = deferredConfirm();
    renderDialog(onConfirm);

    await user.click(button('Remove'));
    const dialog = screen.getByRole('alertdialog');
    expect(button('Removing...')).toBeDisabled();
    expect(dialog).toHaveFocus();

    await user.tab();
    expect(dialog).toHaveFocus();
    await user.tab({ shift: true });
    expect(dialog).toHaveFocus();

    await finish();
    await waitFor(() => expect(button('Remove')).toBeEnabled());
    await user.tab();
    expect(button('Cancel')).toHaveFocus();
  });
});
