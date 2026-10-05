// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
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
// Reads "Adding…" while the request is in flight, so finding it by its idle
// label also waits for the submit to settle.
const approveButton = () => screen.getByRole('button', { name: /^add to list$/i });

function open(
  onApprove: () => Promise<void>,
  { item = proposal, onDelete }: { item?: ApiItem; onDelete?: () => Promise<void> } = {}
) {
  const onClose = vi.fn();
  render(
    <ReviewItemModal
      isOpen
      onClose={onClose}
      onApprove={onApprove}
      onDelete={onDelete}
      item={item}
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
      expect.objectContaining({ name: 'Desk lamp', status: 'available' })
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

describe('ReviewItemModal — answering a proposal', () => {
  it('is titled without naming anyone, and has no status toggle', () => {
    open(vi.fn());
    expect(screen.getByRole('dialog', { name: 'Someone proposed an item' })).toBeInTheDocument();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByText(/select the status/i)).toBeNull();
  });

  // regression: invariant: proposals are anonymous to the owners. Even an item
  // that carried who proposed it (the items API hides `proposedBy` from owners)
  // must not put them anywhere in the dialog, or in its decline confirmation.
  it('regression: shows the proposer nowhere in the dialog or its confirmation', () => {
    const leaky = {
      ...proposal,
      proposedBy: 'proposer-id-7f3a',
      proposedByUsername: 'anna_proposer',
    } as ApiItem;
    open(vi.fn(), { item: leaky, onDelete: vi.fn() });
    const dialog = screen.getByRole('dialog');
    const shown = () =>
      document.body.textContent +
      Array.from(document.querySelectorAll('input, textarea'))
        .map((field) => (field as HTMLInputElement).value)
        .join(' ');
    expect(shown()).not.toMatch(/proposer-id-7f3a|anna_proposer/);
    expect(dialog).toHaveTextContent('Someone proposed an item');

    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(shown()).not.toMatch(/proposer-id-7f3a|anna_proposer/);
  });

  it('adds it to the list as available, sending only what changed', async () => {
    const onApprove = vi.fn().mockResolvedValue(undefined);
    const { onClose } = open(onApprove);

    fireEvent.change(notesInput(), { target: { value: 'Warm light, dimmable' } });
    fireEvent.click(approveButton());

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    // The untouched name and price stay out, so the approval can't write back
    // a version of them the proposer has changed since the dialog opened.
    expect(onApprove).toHaveBeenCalledWith({ notes: 'Warm light, dimmable', status: 'available' });
  });

  it('adds it as a draft from Add as draft', async () => {
    const onApprove = vi.fn().mockResolvedValue(undefined);
    const { onClose } = open(onApprove);

    fireEvent.click(screen.getByRole('button', { name: 'Add as draft' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onApprove).toHaveBeenCalledWith({ status: 'draft' });
  });

  it('reads "Adding…" on the button pressed while the approve runs', async () => {
    let finish!: () => void;
    const onApprove = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    open(onApprove);

    fireEvent.click(screen.getByRole('button', { name: 'Add as draft' }));
    await waitFor(() => expect(onApprove).toHaveBeenCalledTimes(1));
    const footerButtons = screen.getAllByRole('button').map((b) => b.textContent);
    expect(footerButtons).toContain('Adding…');
    expect(footerButtons).toContain('Add to list');
    expect(footerButtons).not.toContain('Add as draft');
    finish();
  });

  it('declines it once confirmed', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const onApprove = vi.fn();
    const { onClose } = open(onApprove, { onDelete });

    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    const confirmation = screen.getByRole('alertdialog');
    expect(confirmation).toHaveTextContent('Decline this proposal?');
    expect(confirmation).toHaveTextContent("It's removed from the list.");
    expect(onDelete).not.toHaveBeenCalled();

    fireEvent.click(within(confirmation).getByRole('button', { name: 'Decline' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onApprove).not.toHaveBeenCalled();
  });

  it('does nothing when the decline is cancelled', () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const { onClose } = open(vi.fn(), { onDelete });

    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' })
    );

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(onDelete).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Someone proposed an item' })).toBeInTheDocument();
  });
});

// The dialog is a snapshot of the proposal as it opened. Once the page's read
// shows it's no longer a proposal, approving or declining from it would act on
// an item the owner never reviewed (WIS-199).
describe('ReviewItemModal — a proposal reviewed or removed meanwhile', () => {
  type State = 'proposed' | 'reviewed' | 'gone';

  function openWithState(
    onApprove: () => Promise<void> = vi.fn().mockResolvedValue(undefined),
    onDelete?: () => Promise<void>
  ) {
    const onClose = vi.fn();
    const onProposalGone = vi.fn();
    const ui = (proposalState: State) => (
      <ReviewItemModal
        isOpen
        onClose={onClose}
        onApprove={onApprove}
        onDelete={onDelete}
        proposalState={proposalState}
        onProposalGone={onProposalGone}
        item={proposal}
        wishlistCurrency="USD"
        userCurrency="USD"
      />
    );
    const { rerender } = render(ui('proposed'));
    return { onClose, onProposalGone, setState: (state: State) => rerender(ui(state)) };
  }

  // regression: the dialog stayed open over a proposal a co-owner had already
  // approved, so its Add to list overwrote their review and its Decline
  // deleted the live item.
  it('regression: asks to be closed as soon as a read shows a co-owner reviewed it', () => {
    const onApprove = vi.fn().mockResolvedValue(undefined);
    const { onProposalGone, setState } = openWithState(onApprove);
    fireEvent.change(nameInput(), { target: { value: 'Desk lamp' } });
    expect(onProposalGone).not.toHaveBeenCalled();

    setState('reviewed');

    expect(onProposalGone).toHaveBeenCalledExactlyOnceWith('reviewed');
    expect(onApprove).not.toHaveBeenCalled();
  });

  it('asks to be closed when the proposal has gone from the list', () => {
    const { onProposalGone, setState } = openWithState();
    setState('gone');
    expect(onProposalGone).toHaveBeenCalledExactlyOnceWith('gone');
  });

  it('asks to be closed with the Decline confirmation open, before anything is deleted', () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const { onProposalGone, setState } = openWithState(undefined, onDelete);
    fireEvent.click(screen.getByRole('button', { name: /^decline$/i }));
    expect(screen.getByText(/decline this proposal\?/i)).toBeInTheDocument();

    setState('reviewed');

    expect(onProposalGone).toHaveBeenCalledExactlyOnceWith('reviewed');
    expect(onDelete).not.toHaveBeenCalled();
  });

  // Its own approve updates the list optimistically, so the item reads as
  // approved while the request runs: that's this dialog's doing, and it closes
  // itself once the approve succeeds.
  it("leaves its own approve alone: it closes on success, with no 'reviewed' note", async () => {
    let finish: () => void = () => {};
    const onApprove = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const { onClose, onProposalGone, setState } = openWithState(onApprove);

    fireEvent.click(approveButton());
    await waitFor(() => expect(onApprove).toHaveBeenCalledTimes(1));
    setState('reviewed');
    expect(onProposalGone).not.toHaveBeenCalled();

    finish();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onProposalGone).not.toHaveBeenCalled();
  });
});

describe('ReviewItemModal — a proposal the proposer edits while it is open (WIS-320)', () => {
  const edited: ApiItem = {
    ...proposal,
    notes: 'Cold light',
    link: 'https://shop.example.com/other-lamp',
    updatedAt: '2024-01-02T00:00:00Z',
  };
  const EDITED_NOTE = /this proposal was edited while you were reviewing it/i;

  function openThenEdit(onApprove: () => Promise<void>) {
    const onClose = vi.fn();
    const ui = (item: ApiItem) => (
      <ReviewItemModal
        isOpen
        onClose={onClose}
        onApprove={onApprove}
        item={item}
        wishlistCurrency="USD"
        userCurrency="USD"
      />
    );
    const { rerender } = render(ui(proposal));
    return { onClose, edit: () => rerender(ui(edited)) };
  }

  // regression: the dialog kept the proposal as it opened, so a link or notes
  // the proposer changed meanwhile were approved onto the list unseen.
  it('regression: refills what the owner left alone, keeps their edits, and says so', async () => {
    const onApprove = vi.fn().mockResolvedValue(undefined);
    const { onClose, edit } = openThenEdit(onApprove);
    fireEvent.change(nameInput(), { target: { value: 'Desk lamp' } });
    expect(screen.queryByText(EDITED_NOTE)).not.toBeInTheDocument();

    edit();

    expect(screen.getByText(EDITED_NOTE)).toBeInTheDocument();
    expect(notesInput()).toHaveValue('Cold light');
    expect(screen.getByLabelText(/product link/i)).toHaveValue(edited.link);
    expect(nameInput()).toHaveValue('Desk lamp');

    fireEvent.click(approveButton());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    // Only the owner's own change: the proposer's edit is already on the item.
    expect(onApprove).toHaveBeenCalledWith({ name: 'Desk lamp', status: 'available' });
  });

  it("keeps a field both of them changed as the owner's", () => {
    const { edit } = openThenEdit(vi.fn().mockResolvedValue(undefined));
    fireEvent.change(notesInput(), { target: { value: 'Owner notes' } });
    edit();
    expect(notesInput()).toHaveValue('Owner notes');
  });

  it('regression: shows the proposer nowhere in the notice', () => {
    const { edit } = openThenEdit(vi.fn().mockResolvedValue(undefined));
    edit();
    expect(screen.getByRole('dialog').textContent).not.toMatch(/proposer|anna|@/i);
  });
});
