// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, onTestFinished } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
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
