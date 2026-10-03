// @vitest-environment jsdom
// Keep adding (WIS-242): the new-item dialogs' checkbox beside the submit
// button. On, a save clears the form for the next item, keeps the currency and
// the dialog open, and puts focus back on Name; off (the default), a save
// closes the dialog as before. A failed save keeps the input either way.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { render, screen, act, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { emulateFocusFixup } from '../focusFixup';

// ImageUpload pulls in react-easy-crop; stub it out. The stub keeps the
// onChange of each render, as an upload keeps the one it started with.
const { uploads } = vi.hoisted(() => ({
  uploads: { onChange: null as ((url: string | null) => void) | null },
}));
vi.mock('@/components/ImageUpload', () => ({
  default: ({ onChange }: { onChange: (url: string | null) => void }) => {
    uploads.onChange = onChange;
    return <div data-testid="image-upload" />;
  },
}));

import AddItemModal from '@/components/AddItemModal';
import ProposeItemModal from '@/components/ProposeItemModal';

type Submit = (item: { name: string; price?: unknown; imageUrl?: string }) => Promise<void>;
const currencies = { wishlistCurrency: 'PLN', userCurrency: 'USD' };

// The modal as a page holds it: open until its onClose, which a test can see.
function Harness({
  kind,
  onSubmit,
  onClose,
}: {
  kind: 'add' | 'propose';
  onSubmit: Submit;
  onClose: () => void;
}) {
  const [open, setOpen] = useState(true);
  const close = () => {
    onClose();
    setOpen(false);
  };
  return kind === 'add' ? (
    <AddItemModal isOpen={open} onClose={close} onAdd={onSubmit} {...currencies} />
  ) : (
    <ProposeItemModal isOpen={open} onClose={close} onPropose={onSubmit} {...currencies} />
  );
}

const modals = [
  { kind: 'add' as const, title: 'Add new item', submit: 'Add item' },
  { kind: 'propose' as const, title: 'Propose new item', submit: 'Propose item' },
];

// useBodyScrollLock restores the scroll position on close; jsdom lacks scrollTo.
beforeAll(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterAll(() => vi.restoreAllMocks());
beforeEach(() => cleanup());
// A disabled control drops focus to <body>, as in a browser.
beforeEach(() => emulateFocusFixup());

describe.each(modals)('$kind dialog — Keep adding', ({ kind, title, submit }) => {
  const dialog = () => screen.queryByRole('dialog', { name: title });
  const name = () => screen.getByLabelText(/item name/i);
  const price = () => screen.getByLabelText(/^price/i);
  const keepAdding = () => screen.getByRole('checkbox', { name: 'Keep adding' });

  function open(onSubmit: Submit = vi.fn().mockResolvedValue(undefined)) {
    const onClose = vi.fn();
    render(<Harness kind={kind} onSubmit={onSubmit} onClose={onClose} />);
    return { onSubmit, onClose, user: userEvent.setup() };
  }

  it('is off by default, and a save closes the dialog as before', async () => {
    const { user, onSubmit, onClose } = open();
    expect(keepAdding()).not.toBeChecked();

    await user.type(name(), 'Bike');
    await user.click(screen.getByRole('button', { name: submit }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeNull();
  });

  it('saves two items in a row without closing, clearing the fields and keeping the currency', async () => {
    const { user, onSubmit, onClose } = open();
    await user.click(keepAdding());

    await user.type(name(), 'Bike');
    await user.type(price(), '120');
    await user.click(screen.getByRole('button', { name: submit }));

    await waitFor(() => expect(name()).toHaveValue(''));
    expect(onSubmit).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: 'Bike', price: { value: 12000, currency: 'pln' } })
    );
    expect(price()).toHaveValue('');
    expect(screen.getByRole('button', { name: 'PLN' })).toBeInTheDocument();
    expect(keepAdding()).toBeChecked();
    // The next item starts from its name.
    await waitFor(() => expect(name()).toHaveFocus());

    await user.type(name(), 'Helmet');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(onSubmit).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Helmet' }));
    await waitFor(() => expect(name()).toHaveValue(''));
    await waitFor(() => expect(name()).toHaveFocus());
    expect(dialog()).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    // Cleared, it has nothing unsaved: closing asks nothing.
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: 'Discard changes?' })).toBeNull();
  });

  // regression: with Keep adding the form stays mounted, so a photo still
  // uploading when an item was saved landed in the cleared form and went onto
  // the next item.
  it('regression: a photo that finishes uploading after its item was saved stays off the next one', async () => {
    const { user, onSubmit } = open();
    await user.click(keepAdding());
    await user.type(name(), 'Bike');
    // The upload starts here, with the onChange of this render.
    const lateUpload = uploads.onChange!;
    await user.click(screen.getByRole('button', { name: submit }));
    await waitFor(() => expect(name()).toHaveValue(''));

    await act(async () => lateUpload('https://blob.example/uploads/me/bike.webp'));

    await user.type(name(), 'Helmet');
    await user.click(screen.getByRole('button', { name: submit }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(onSubmit.mock.calls[1][0]).toEqual(expect.objectContaining({ name: 'Helmet' }));
    expect(onSubmit.mock.calls[1][0].imageUrl).toBeUndefined();
  });

  // regression: a failed save must keep what was typed (WIS-72), and Keep
  // adding's clear-for-the-next-item must not run on one.
  it('regression: a failed save with Keep adding on keeps the input and the dialog', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    let fail!: () => void;
    const onSubmit = vi.fn(
      () =>
        new Promise<void>((_, reject) => {
          fail = () => reject(new Error('Something went wrong'));
        })
    );
    const { user, onClose } = open(onSubmit);
    await user.click(keepAdding());
    await user.type(name(), 'Bike');
    await user.type(price(), '120');
    await user.click(screen.getByRole('button', { name: submit }));
    expect(onSubmit).toHaveBeenCalledTimes(1);

    await act(async () => fail());

    expect(dialog()).toBeInTheDocument();
    expect(name()).toHaveValue('Bike');
    expect(price()).toHaveValue('120.00');
    expect(keepAdding()).toBeChecked();
    expect(onClose).not.toHaveBeenCalled();
    // Focus goes back to the submit button, as after any failed save.
    expect(screen.getByRole('button', { name: submit })).toHaveFocus();
    consoleError.mockRestore();
  });

  it('starts off again each time the dialog opens', async () => {
    const user = userEvent.setup();
    function Reopenable() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button onClick={() => setOpen(true)}>Open</button>
          {kind === 'add' ? (
            <AddItemModal
              isOpen={open}
              onClose={() => setOpen(false)}
              onAdd={vi.fn()}
              {...currencies}
            />
          ) : (
            <ProposeItemModal
              isOpen={open}
              onClose={() => setOpen(false)}
              onPropose={vi.fn()}
              {...currencies}
            />
          )}
        </>
      );
    }
    render(<Reopenable />);
    await user.click(keepAdding());
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(keepAdding()).not.toBeChecked();
  });
});

it('is not offered when adding a copy of an item (Save to my list)', () => {
  render(
    <AddItemModal
      isOpen
      onClose={vi.fn()}
      onAdd={vi.fn()}
      initialItem={{ name: 'Lamp', imageUrl: null, price: null, link: null }}
      {...currencies}
    />
  );
  expect(screen.getByRole('dialog', { name: 'Add new item' })).toBeInTheDocument();
  expect(screen.queryByRole('checkbox', { name: 'Keep adding' })).toBeNull();
});

it('keeps an owner’s Draft status for the next item, as a batch of drafts', async () => {
  const user = userEvent.setup();
  const onAdd = vi.fn().mockResolvedValue(undefined);
  render(<AddItemModal isOpen onClose={vi.fn()} onAdd={onAdd} {...currencies} />);
  await user.click(screen.getByRole('checkbox', { name: 'Keep adding' }));
  await user.click(screen.getByRole('radio', { name: 'Draft' }));
  await user.type(screen.getByLabelText(/item name/i), 'Surprise A');
  await user.click(screen.getByRole('button', { name: 'Add item' }));
  await waitFor(() => expect(screen.getByLabelText(/item name/i)).toHaveValue(''));

  expect(screen.getByRole('radio', { name: 'Draft' })).toBeChecked();
  await user.type(screen.getByLabelText(/item name/i), 'Surprise B');
  await user.click(screen.getByRole('button', { name: 'Add item' }));
  await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(2));
  expect(onAdd.mock.calls.map(([item]) => item.status)).toEqual(['draft', 'draft']);
});
