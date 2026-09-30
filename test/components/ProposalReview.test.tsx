// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import type { ApiItem } from '@/types/api';

// ImageUpload pulls in react-easy-crop; stub it out.
vi.mock('@/components/ImageUpload', () => ({
  default: () => <div data-testid="image-upload" />,
}));

import ReviewItemModal from '@/components/ReviewItemModal';

const proposal: ApiItem = {
  _id: 'item-1',
  wishlist: 'w1',
  name: 'Lamp',
  price: { value: 2500, currency: 'usd' },
  notes: 'Warm light',
  status: 'proposed',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

const nameInput = () => screen.getByLabelText(/item name/i);
const notesInput = () => screen.getByLabelText(/notes/i);
// Reads "Approving..." while the request is in flight, so finding it by its
// idle label also waits for the submit to settle.
const approveButton = () => screen.getByRole('button', { name: /^approve item$/i });

function open(onApprove: () => Promise<void>) {
  const onClose = vi.fn();
  render(
    <ReviewItemModal
      isOpen
      onClose={onClose}
      onApprove={onApprove}
      item={proposal}
      wishlistCurrency="USD"
      userCurrency="USD"
    />
  );
  return { onClose };
}

async function renameAndApprove() {
  fireEvent.change(nameInput(), { target: { value: 'Desk lamp' } });
  fireEvent.click(approveButton());
  await waitFor(() => expect(approveButton()).toBeEnabled());
}

// useBodyScrollLock restores the scroll position on close; jsdom lacks scrollTo.
beforeAll(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterAll(() => vi.restoreAllMocks());
beforeEach(() => cleanup());

describe('ReviewItemModal — approve outcome', () => {
  // ItemForm logs the rejection it catches; keep the test output clean.
  beforeEach(() => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    return () => consoleError.mockRestore();
  });

  // A rejecting onApprove is how the page reports a failed approve (see
  // e2e/proposal-review.authed.spec.ts); the modal must stay open for a retry.
  it('stays open with the edits when the approve fails', async () => {
    const onApprove = vi.fn().mockRejectedValue(new Error('Too many requests'));
    const { onClose } = open(onApprove);

    await renameAndApprove();

    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onApprove).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Desk lamp', status: 'available', proposedBy: null })
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(nameInput()).toHaveValue('Desk lamp');
    expect(notesInput()).toHaveValue('Warm light');
  });

  // regression: the modal caught onApprove's rejection itself, so ItemForm took
  // the failure for a success and moved its unsaved-changes baseline to the
  // rejected edits. Undoing a later tweak then let the modal close without
  // asking, silently dropping the rename.
  it('regression: still measures unsaved changes against the proposal after a failure', async () => {
    const { onClose } = open(vi.fn().mockRejectedValue(new Error('Server error')));

    await renameAndApprove();
    fireEvent.change(notesInput(), { target: { value: 'Warm light, dimmable' } });
    fireEvent.change(notesInput(), { target: { value: 'Warm light' } });
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(/discard changes\?/i)).toBeInTheDocument();
  });

  it('closes once a retried approve succeeds', async () => {
    const onApprove = vi
      .fn()
      .mockRejectedValueOnce(new Error('Server error'))
      .mockResolvedValueOnce(undefined);
    const { onClose } = open(onApprove);

    await renameAndApprove();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(approveButton());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onApprove).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/discard changes\?/i)).toBeNull();
  });
});
