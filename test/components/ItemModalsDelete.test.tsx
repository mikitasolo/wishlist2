// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ApiItem } from '@/types/api';

// ImageUpload pulls in react-easy-crop; stub it out.
vi.mock('@/components/ImageUpload', () => ({
  default: () => <div data-testid="image-upload" />,
}));

import EditItemModal from '@/components/EditItemModal';
import ReviewItemModal from '@/components/ReviewItemModal';

function item(overrides: Partial<ApiItem>): ApiItem {
  return {
    _id: 'item-1',
    wishlist: 'w1',
    name: 'Bike',
    status: 'available',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  } as ApiItem;
}

// Both item modals offer a delete behind a confirmation (the review's Decline);
// run every case on each.
const modals = [
  {
    name: 'EditItemModal',
    submitLabel: 'Save',
    submittingLabel: 'Saving…',
    deleteLabel: 'Delete item',
    confirmLabel: 'Delete',
    pendingLabel: 'Deleting…',
    renderModal: (onDelete: () => Promise<void>, onClose: () => void) =>
      render(
        <EditItemModal
          isOpen
          onClose={onClose}
          onSave={vi.fn()}
          onDelete={onDelete}
          item={item({})}
          wishlistCurrency="USD"
          userCurrency="USD"
        />
      ),
  },
  {
    name: 'ReviewItemModal',
    submitLabel: 'Add to list',
    submittingLabel: 'Adding…',
    // A review declines the proposal, which deletes it.
    deleteLabel: 'Decline',
    confirmLabel: 'Decline',
    pendingLabel: 'Declining…',
    renderModal: (onDelete: () => Promise<void>, onClose: () => void) =>
      render(
        <ReviewItemModal
          isOpen
          onClose={onClose}
          onApprove={vi.fn()}
          onDelete={onDelete}
          item={item({ status: 'proposed' })}
          wishlistCurrency="USD"
          userCurrency="USD"
        />
      ),
  },
];

const confirmation = () => screen.queryByRole('alertdialog');

// An onDelete that stays in flight until the test calls `finish`.
function pendingDelete() {
  let finish!: () => void;
  const onDelete = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  return { onDelete, finish: () => finish() };
}

// useBodyScrollLock restores the scroll position on close; jsdom lacks scrollTo.
beforeAll(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterAll(() => vi.restoreAllMocks());
beforeEach(() => cleanup());

describe.each(modals)('$name — delete outcome', (modal) => {
  const { renderModal, submitLabel, submittingLabel, pendingLabel } = modal;
  const deleteItemButton = () => screen.getByRole('button', { name: modal.deleteLabel });
  const confirmButton = () =>
    within(confirmation()!).getByRole('button', { name: modal.confirmLabel });
  const confirmDelete = () => fireEvent.click(confirmButton());

  // The modal logs the rejection it catches; keep the test output clean.
  beforeEach(() => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    return () => consoleError.mockRestore();
  });

  // The page rejects onDelete when the DELETE fails (after toasting the error),
  // so the item is still there: the modal must stay open with it, answer the
  // confirmation, and leave nothing disabled.
  it('stays open with the item when the delete fails', async () => {
    const onDelete = vi.fn().mockRejectedValue(new Error('Something went wrong'));
    const onClose = vi.fn();
    renderModal(onDelete, onClose);

    fireEvent.click(deleteItemButton());
    confirmDelete();

    // The confirmation is answered either way; a failure drops back to the modal.
    await waitFor(() => expect(confirmation()).toBeNull());
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText(/item name/i)).toHaveValue('Bike');
    expect(deleteItemButton()).toBeEnabled();
  });

  // regression: the confirmation's buttons are disabled while the delete runs,
  // which dropped focus to <body>; after a failed delete it stayed there, and
  // the next Tab started from the top of the page instead of the modal.
  it('regression: hands focus back to Delete item in the modal when the delete fails', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn().mockRejectedValue(new Error('Something went wrong'));
    renderModal(onDelete, vi.fn());

    await user.click(deleteItemButton());
    expect(within(confirmation()!).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.click(confirmButton());

    await waitFor(() => expect(confirmation()).toBeNull());
    expect(deleteItemButton()).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);
  });

  it('lets the user retry after a failure, and closes once it succeeds', async () => {
    const onDelete = vi
      .fn()
      .mockRejectedValueOnce(new Error('Something went wrong'))
      .mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    renderModal(onDelete, onClose);

    fireEvent.click(deleteItemButton());
    confirmDelete();
    await waitFor(() => expect(confirmation()).toBeNull());
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(deleteItemButton());
    confirmDelete();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onDelete).toHaveBeenCalledTimes(2);
  });

  // regression: nothing stopped a second confirm click while the first delete
  // was in flight, so the page ran its delete handler twice and doubled its toast.
  // The confirmation now shows the delete as running and ignores the second click.
  it('regression: sends one delete when the confirmation is clicked twice', async () => {
    const { onDelete, finish } = pendingDelete();
    const onClose = vi.fn();
    renderModal(onDelete, onClose);

    fireEvent.click(deleteItemButton());
    confirmDelete();
    const pending = within(confirmation()!).getByRole('button', { name: pendingLabel });
    expect(pending).toBeDisabled();
    fireEvent.click(pending);
    expect(onDelete).toHaveBeenCalledTimes(1);

    finish();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  // regression: the form's submit button took its label from the disabled state,
  // which a delete sets too, so while a delete ran it read "Saving…" /
  // "Adding…", as if the user's changes were being saved.
  it('regression: keeps the form disabled but not labelled as saving while the delete runs', async () => {
    const { onDelete, finish } = pendingDelete();
    renderModal(onDelete, vi.fn());

    fireEvent.click(deleteItemButton());
    confirmDelete();
    expect(within(confirmation()!).getByRole('button', { name: pendingLabel })).toBeDisabled();
    expect(screen.getByRole('button', { name: submitLabel })).toBeDisabled();
    expect(screen.queryByRole('button', { name: submittingLabel })).toBeNull();
    expect(deleteItemButton()).toBeDisabled();

    finish();
    await waitFor(() => expect(confirmation()).toBeNull());
  });
});
