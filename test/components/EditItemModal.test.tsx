// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import type { ApiItem } from '@/types/api';

// ImageUpload pulls in react-easy-crop; stub it out with a button that uploads
// a replacement.
vi.mock('@/components/ImageUpload', () => ({
  default: ({ onChange }: { onChange: (url: string | null) => void }) => (
    <button type="button" onClick={() => onChange('https://images.example.com/new.jpg')}>
      Replace image
    </button>
  ),
}));

import EditItemModal from '@/components/EditItemModal';

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

const mostWantedSwitch = () => screen.queryByRole('switch', { name: /most wanted/i });
const currencies = { wishlistCurrency: 'USD', userCurrency: 'USD' };

// useBodyScrollLock restores the scroll position on close; jsdom lacks scrollTo.
beforeAll(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterAll(() => vi.restoreAllMocks());
beforeEach(() => cleanup());

describe('EditItemModal — save outcome', () => {
  const saved = () => item({ price: { value: 5000, currency: 'eur' } });
  const nameInput = () => screen.getByLabelText(/item name/i);
  const priceInput = () => screen.getByLabelText(/^price$/i);
  const saveButton = () => screen.getByRole('button', { name: /^save changes$/i });

  const editAndSave = () => {
    fireEvent.change(nameInput(), { target: { value: 'Road bike' } });
    fireEvent.change(priceInput(), { target: { value: '120.50' } });
    fireEvent.click(saveButton());
  };
  // Saving has settled once the button is back to its idle label.
  const settled = () => waitFor(() => expect(saveButton()).toBeEnabled());

  // ItemForm logs the rejection it catches; keep the test output clean.
  beforeEach(() => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    return () => consoleError.mockRestore();
  });

  // regression: a failed save closed the modal and threw away everything the
  // user had changed. The close came from the page, which resolved whatever the
  // outcome (covered by e2e/item-edit.authed.spec.ts); this pins the modal's
  // half: a rejected onSave neither closes it nor resets the fields.
  it('regression: stays open with the edited name and price when the save fails', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('Too many requests'));
    const onClose = vi.fn();
    render(
      <EditItemModal isOpen onClose={onClose} onSave={onSave} item={saved()} {...currencies} />
    );

    editAndSave();
    await settled();

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(nameInput()).toHaveValue('Road bike');
    expect(priceInput()).toHaveValue('120.50');
    expect(screen.getByRole('button', { name: 'EUR' })).toBeInTheDocument();
  });

  // regression: with the rejection swallowed, ItemForm took the failure for a
  // success and made the unsaved draft its baseline, so undoing a later
  // keystroke marked the form clean and closing discarded the draft unasked.
  it('regression: still asks before discarding the changes after a failure', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('Network error'));
    const onClose = vi.fn();
    render(
      <EditItemModal isOpen onClose={onClose} onSave={onSave} item={saved()} {...currencies} />
    );

    editAndSave();
    await settled();
    expect(onSave).toHaveBeenCalledTimes(1);

    fireEvent.change(nameInput(), { target: { value: 'Road bikes' } });
    fireEvent.change(nameInput(), { target: { value: 'Road bike' } });
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(/discard changes\?/i)).toBeInTheDocument();
  });

  it('lets the user retry after a failure, and closes once it succeeds', async () => {
    const onSave = vi
      .fn()
      .mockRejectedValueOnce(new Error('Server error'))
      .mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    render(
      <EditItemModal isOpen onClose={onClose} onSave={onSave} item={saved()} {...currencies} />
    );

    editAndSave();
    await settled();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(saveButton());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: 'Road bike', price: { value: 12050, currency: 'eur' } })
    );
  });
});

describe('EditItemModal — most wanted', () => {
  // Owners are booking-blind, so an edit that sent a status could wipe a
  // booking they can't see. Flagging an item is a content edit like any other.
  it('saves the flag without sending a status', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <EditItemModal isOpen onClose={vi.fn()} onSave={onSave} item={item({})} {...currencies} />
    );

    fireEvent.click(mostWantedSwitch()!);
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toMatchObject({ mostWanted: true });
    expect(onSave.mock.calls[0][0]).not.toHaveProperty('status');
  });

  it('offers no switch to a proposer editing their own proposal', () => {
    render(
      <EditItemModal
        isOpen
        onClose={vi.fn()}
        onSave={vi.fn()}
        item={item({ status: 'proposed' })}
        {...currencies}
      />
    );
    expect(mostWantedSwitch()).toBeNull();
  });
});

describe('EditItemModal — sends only what changed', () => {
  const ALICES_IMAGE = 'https://store.public.blob.vercel-storage.com/uploads/alice/mug.webp';
  const BOBS_IMAGE = 'https://store.public.blob.vercel-storage.com/uploads/bob/red-mug.webp';
  const opened = () =>
    item({
      name: 'Blue Mug',
      imageUrl: ALICES_IMAGE,
      price: { value: 1250, currency: 'usd' },
      link: 'https://shop.example.com/mug',
      notes: 'Any colour',
      mostWanted: false,
    });
  const saveButton = () => screen.getByRole('button', { name: /^save changes$/i });
  const notesInput = () => screen.getByLabelText(/^notes$/i);

  function open(onSave = vi.fn().mockResolvedValue(undefined), onClose = vi.fn()) {
    const view = render(
      <EditItemModal isOpen onClose={onClose} onSave={onSave} item={opened()} {...currencies} />
    );
    return { ...view, onSave, onClose };
  }

  // regression: the modal sent every content field as the form was filled when
  // it opened. With a co-owner's save in between (a new image and name), a
  // notes-only edit wrote the old image and name back over theirs: it put back
  // an image their replacement had already freed and freed theirs, or was
  // refused as someone else's upload. test/api/itemEditSave.test.ts sends the
  // same request to the route.
  it('regression: a notes-only save sends just the notes, not the image or name it loaded', async () => {
    const { onSave, onClose, rerender } = open();

    // A co-owner replaces the image and renames the item while the modal is
    // open. Even handed the item as it is now, the form keeps what it loaded.
    rerender(
      <EditItemModal
        isOpen
        onClose={onClose}
        onSave={onSave}
        item={{ ...opened(), name: 'Red Mug', imageUrl: BOBS_IMAGE }}
        {...currencies}
      />
    );
    expect(screen.getByLabelText(/item name/i)).toHaveValue('Blue Mug');

    fireEvent.change(notesInput(), { target: { value: 'Size M' } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({ notes: 'Size M' });
  });

  it('sends a replaced image, and nothing else', async () => {
    const { onSave } = open();
    fireEvent.click(screen.getByRole('button', { name: /replace image/i }));
    fireEvent.click(saveButton());
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith({ imageUrl: 'https://images.example.com/new.jpg' });
  });

  it('sends the price as one field when only its currency changed', async () => {
    const { onSave } = open();
    fireEvent.click(screen.getByRole('button', { name: 'USD' }));
    fireEvent.click(screen.getByRole('button', { name: /EUR\s*Euro/ }));
    fireEvent.click(saveButton());
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith({ price: { value: 1250, currency: 'eur' } });
  });

  it('closes without a request when nothing changed', async () => {
    const { onSave, onClose } = open();
    fireEvent.click(saveButton());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('closes without a request, or a prompt, when only blanks were added', async () => {
    const { onSave, onClose } = open();
    fireEvent.change(screen.getByLabelText(/item name/i), { target: { value: 'Blue Mug  ' } });
    fireEvent.change(notesInput(), { target: { value: ' Any colour' } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByText(/discard changes\?/i)).toBeNull();
  });

  it("keeps the item's name when it was emptied to blanks", async () => {
    const { onSave } = open();
    fireEvent.change(screen.getByLabelText(/item name/i), { target: { value: '   ' } });
    fireEvent.change(notesInput(), { target: { value: 'Size M' } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith({ notes: 'Size M' });
  });
});
