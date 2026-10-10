// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
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

// Both item modals offer a delete (the review's Decline);
// run every case on each.
const modals = [
  {
    name: 'EditItemModal',
    submitLabel: 'Save',
    submittingLabel: 'Saving…',
    deleteLabel: 'Delete item',
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
  const { renderModal, submitLabel, submittingLabel } = modal;
  const deleteItemButton = () => screen.getByRole('button', { name: modal.deleteLabel });

  // The modal logs the rejection it catches; keep the test output clean.
  beforeEach(() => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    return () => consoleError.mockRestore();
  });

  // WIS-387: the page offers Undo before anything is sent, so the modal asks
  // nothing and closes as soon as the page has taken the item off.
  it('deletes without a confirmation and closes', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    renderModal(onDelete, onClose);

    fireEvent.click(deleteItemButton());
    expect(confirmation()).toBeNull();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  // A rejected onDelete means the item is still there: the modal stays open
  // with it and leaves nothing disabled.
  it('stays open with the item when the delete fails', async () => {
    const onDelete = vi.fn().mockRejectedValue(new Error('Something went wrong'));
    const onClose = vi.fn();
    renderModal(onDelete, onClose);

    fireEvent.click(deleteItemButton());

    await waitFor(() => expect(deleteItemButton()).toBeEnabled());
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText(/item name/i)).toHaveValue('Bike');
  });

  // regression: nothing stopped a second click while the first delete was in
  // flight, so the page ran its delete handler twice and doubled its toast.
  it('regression: sends one delete when Delete is clicked twice', async () => {
    const { onDelete, finish } = pendingDelete();
    const onClose = vi.fn();
    renderModal(onDelete, onClose);

    fireEvent.click(deleteItemButton());
    fireEvent.click(deleteItemButton());
    expect(onDelete).toHaveBeenCalledTimes(1);

    finish();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  // regression: the form's submit button took its label from the disabled state,
  // which a delete sets too, so while a delete ran it read "Saving…" /
  // "Adding…", as if the user's changes were being saved.
  it('regression: keeps the form disabled but not labelled as saving while the delete runs', async () => {
    const { onDelete, finish } = pendingDelete();
    const onClose = vi.fn();
    renderModal(onDelete, onClose);

    fireEvent.click(deleteItemButton());
    expect(screen.getByRole('button', { name: submitLabel })).toBeDisabled();
    expect(screen.queryByRole('button', { name: submittingLabel })).toBeNull();
    expect(deleteItemButton()).toBeDisabled();

    finish();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});
