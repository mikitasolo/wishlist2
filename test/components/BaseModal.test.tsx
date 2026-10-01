// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { render, screen, act, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, useState, type FormEvent, type ReactNode } from 'react';
import BaseModal from '@/components/BaseModal';
import ConfirmDialog from '@/components/ConfirmDialog';
import Select from '@/components/Select';
import { emulateFocusFixup } from '../focusFixup';

// useBodyScrollLock restores the scroll position on close; jsdom lacks scrollTo.
beforeAll(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterAll(() => vi.restoreAllMocks());
beforeEach(() => cleanup());

/**
 * A page with a button that opens the modal and another one behind it. The
 * modal's "Delete Item" opens a confirmation rendered beside it, as the item
 * modals do. With `mountOpen`, the modal mounts already open, as the wishlist
 * page's item modals do.
 */
function ModalPage({ content, mountOpen }: { content?: ReactNode; mountOpen?: boolean }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  return (
    <>
      <button onClick={() => setModalOpen(true)}>Open</button>
      <button>Behind</button>
      <BaseModal
        key={mountOpen ? String(modalOpen) : undefined}
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Edit Item"
        titleId="edit-item-title"
      >
        {content ?? (
          <>
            <input aria-label="Item Name" />
            <button onClick={() => setConfirmOpen(true)}>Delete Item</button>
          </>
        )}
      </BaseModal>
      <ConfirmDialog
        isOpen={confirmOpen}
        title="Delete Item"
        message="Are you sure?"
        onConfirm={() => setConfirmOpen(false)}
        onCancel={() => setConfirmOpen(false)}
        confirmText="Delete"
        type="danger"
      />
    </>
  );
}

const button = (name: string) => screen.getByRole('button', { name });
const modal = () => screen.getByRole('dialog', { name: 'Edit Item' });

async function openModal() {
  const user = userEvent.setup();
  render(<ModalPage />);
  await user.click(button('Open'));
  return user;
}

describe('BaseModal — keyboard focus', () => {
  it('moves focus to the close button when it opens', async () => {
    await openModal();

    expect(button('Close modal')).toHaveFocus();
  });

  it('leaves focus on an autoFocus field in its content, and still returns it on close', async () => {
    const user = userEvent.setup();
    render(<ModalPage content={<input aria-label="Search" autoFocus />} />);

    await user.click(button('Open'));
    expect(screen.getByLabelText('Search')).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(button('Open')).toHaveFocus();
  });

  // StrictMode (on in `next dev`) runs the effects of a modal that mounts open twice.
  it('leaves an autoFocus field focused under StrictMode too', async () => {
    const user = userEvent.setup();
    render(
      <StrictMode>
        <ModalPage content={<input aria-label="Search" autoFocus />} mountOpen />
      </StrictMode>
    );

    await user.click(button('Open'));
    expect(screen.getByLabelText('Search')).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(button('Open')).toHaveFocus();
  });

  it('keeps Tab and Shift+Tab inside, wrapping at both ends', async () => {
    const user = await openModal();

    await user.tab();
    expect(screen.getByLabelText('Item Name')).toHaveFocus();
    await user.tab();
    expect(button('Delete Item')).toHaveFocus();
    await user.tab();
    expect(button('Close modal')).toHaveFocus();
    await user.tab({ shift: true });
    expect(button('Delete Item')).toHaveFocus();
  });

  it('brings focus back inside when it has dropped to the page', async () => {
    const user = await openModal();

    act(() => (document.activeElement as HTMLElement).blur());
    await user.tab();
    expect(button('Close modal')).toHaveFocus();

    act(() => (document.activeElement as HTMLElement).blur());
    await user.tab({ shift: true });
    expect(button('Delete Item')).toHaveFocus();
  });

  it('returns focus to the button that opened it when it closes', async () => {
    const user = await openModal();

    await user.click(button('Close modal'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button('Open')).toHaveFocus();

    await user.click(button('Open'));
    await user.keyboard('{Escape}');
    expect(button('Open')).toHaveFocus();
  });

  // regression: neither dialog kept Tab inside itself, so from a confirmation
  // stacked over a modal (or over a page) Tab reached whatever was behind its
  // backdrop. On /booked that opened a second confirmation for the same
  // reservation from "Mark as gifted?", and confirming both sent two
  // conflicting requests for it.
  it('regression: traps focus in a confirmation stacked over it, then in itself again once it closes', async () => {
    const user = await openModal();
    await user.click(button('Delete Item'));
    const confirmation = within(screen.getByRole('alertdialog'));

    expect(confirmation.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.tab();
    expect(confirmation.getByRole('button', { name: 'Delete' })).toHaveFocus();
    await user.tab();
    expect(confirmation.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(confirmation.getByRole('button', { name: 'Delete' })).toHaveFocus();

    // Escape answers only the confirmation; focus goes back to what opened it,
    // and the modal traps Tab again.
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(modal()).toBeInTheDocument();
    expect(button('Delete Item')).toHaveFocus();
    await user.tab();
    expect(button('Close modal')).toHaveFocus();
    await user.tab({ shift: true });
    expect(button('Delete Item')).toHaveFocus();

    // Closing the modal hands focus back to the page.
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button('Open')).toHaveFocus();
  });
});

/**
 * A modal whose form saves through `onSave`, disabling its controls (and so
 * the modal's close button) while it runs, as the item modals do. A save that
 * resolves closes the modal; one that rejects leaves it open, and with
 * `dropSubmitOnFailure` takes the submit button away. `extra` goes at the top
 * of the form.
 */
function SavingPage({
  onSave,
  extra,
  dropSubmitOnFailure,
}: {
  onSave: () => Promise<void>;
  extra?: ReactNode;
  dropSubmitOnFailure?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave();
      setOpen(false);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <button onClick={() => setOpen(true)}>Open</button>
      <BaseModal
        isOpen={open}
        onClose={() => setOpen(false)}
        title="Edit Item"
        titleId="edit-item-title"
        isSubmitting={saving}
      >
        <form onSubmit={save}>
          {extra}
          <input aria-label="Item Name" disabled={saving} />
          {failed && dropSubmitOnFailure ? (
            <p>Saving is unavailable right now.</p>
          ) : (
            <button type="submit" disabled={saving}>
              Save
            </button>
          )}
        </form>
      </BaseModal>
    </>
  );
}

/** An onSave that stays in flight until the test settles it. */
function deferredSave() {
  let settle!: { resolve: () => void; reject: (error: Error) => void };
  const onSave = vi.fn(
    () =>
      new Promise<void>((resolve, reject) => {
        settle = { resolve, reject };
      })
  );
  return {
    onSave,
    succeed: () => act(async () => settle.resolve()),
    fail: () => act(async () => settle.reject(new Error('Save failed'))),
  };
}

describe('BaseModal — keyboard focus while submitting', () => {
  // A disabled control drops focus to <body>, as in a browser.
  beforeEach(() => emulateFocusFixup());

  async function startSaving(props: { extra?: ReactNode; dropSubmitOnFailure?: boolean } = {}) {
    const user = userEvent.setup();
    const save = deferredSave();
    render(<SavingPage onSave={save.onSave} {...props} />);
    await user.click(button('Open'));
    await user.click(button('Save'));
    expect(button('Save')).toBeDisabled();
    expect(button('Close modal')).toBeDisabled();
    return { user, ...save };
  }

  // regression: disabling the focused submit button dropped focus to <body>,
  // behind the backdrop; after a failed save it stayed there, so Enter did
  // nothing and the next Tab started over at the close button.
  it('regression: holds focus on its panel, then hands it back to the control that had it', async () => {
    const { user, fail } = await startSaving();

    expect(modal()).toHaveFocus();
    await user.tab();
    expect(modal()).toHaveFocus();
    await user.tab({ shift: true });
    expect(modal()).toHaveFocus();

    await fail();
    expect(button('Save')).toBeEnabled();
    expect(button('Save')).toHaveFocus();
  });

  it("keeps focus on its panel when that control can't take it again", async () => {
    const { user, fail } = await startSaving({ dropSubmitOnFailure: true });

    await fail();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(modal()).toHaveFocus();
    await user.tab();
    expect(button('Close modal')).toHaveFocus();
  });

  it('leaves focus where it was moved inside it while submitting', async () => {
    const { user, fail } = await startSaving({ extra: <a href="#help">Help</a> });
    const help = screen.getByRole('link', { name: 'Help' });

    // The link stays enabled, so Tab reaches it from the panel.
    await user.tab();
    expect(help).toHaveFocus();

    await fail();
    expect(help).toHaveFocus();
  });

  it('leaves focus on a control that stays enabled while submitting', async () => {
    const user = userEvent.setup();
    const { onSave, fail } = deferredSave();
    render(<SavingPage onSave={onSave} extra={<input aria-label="Search" />} />);
    await user.click(button('Open'));
    const search = screen.getByLabelText('Search');

    // Enter submits the form from a field that saving doesn't disable.
    await user.click(search);
    await user.keyboard('{Enter}');
    expect(button('Save')).toBeDisabled();
    expect(search).toHaveFocus();

    await fail();
    expect(search).toHaveFocus();
  });

  it('hands focus back to the opener when a successful submit closes it', async () => {
    const { succeed } = await startSaving();

    await succeed();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button('Open')).toHaveFocus();
  });
});

/**
 * A modal whose content has a Select between a field and a button that opens
 * a confirmation over the modal.
 */
function SelectPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sort, setSort] = useState('newest');
  return (
    <>
      <button onClick={() => setModalOpen(true)}>Open</button>
      <BaseModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Edit Item"
        titleId="edit-item-title"
      >
        <input aria-label="Item Name" />
        <Select
          value={sort}
          onChange={setSort}
          options={[
            { value: 'newest', label: 'Newest' },
            { value: 'oldest', label: 'Oldest' },
          ]}
          ariaLabel="Sort by"
        />
        <button onClick={() => setConfirmOpen(true)}>Delete Item</button>
      </BaseModal>
      <ConfirmDialog
        isOpen={confirmOpen}
        title="Delete Item"
        message="Are you sure?"
        onConfirm={() => setConfirmOpen(false)}
        onCancel={() => setConfirmOpen(false)}
        confirmText="Delete"
        type="danger"
      />
    </>
  );
}

describe('BaseModal — a Select menu portalled out of it', () => {
  const trigger = () => button('Sort by');
  const option = (name: string) => screen.getByRole('option', { name });

  async function openMenu() {
    const user = userEvent.setup();
    render(<SelectPage />);
    await user.click(button('Open'));
    await user.tab();
    await user.tab();
    expect(trigger()).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    return user;
  }

  // regression: the menu is rendered on <body>, outside the modal, so its
  // options weren't among the trap's Tab stops: Tab skipped them, and focus
  // on one counted as outside the modal.
  it('regression: puts the options in its Tab order right after their trigger', async () => {
    const user = await openMenu();

    await user.tab();
    expect(option('Newest')).toHaveFocus();
    await user.tab();
    expect(option('Oldest')).toHaveFocus();
    await user.tab({ shift: true });
    expect(option('Newest')).toHaveFocus();
    await user.tab({ shift: true });
    expect(trigger()).toHaveFocus();
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    // On past the last option to the next field, which closes the menu.
    await user.tab();
    await user.tab();
    await user.tab();
    expect(button('Delete Item')).toHaveFocus();
    expect(screen.queryByRole('listbox')).toBeNull();

    // Once it's closed, Tab goes straight from the trigger to the next field.
    await user.tab({ shift: true });
    expect(trigger()).toHaveFocus();
    await user.tab();
    expect(button('Delete Item')).toHaveFocus();
  });

  // With the menu open and focus elsewhere in the modal (moved there from the
  // trigger), Shift+Tab from the next field goes back into the menu.
  it('puts the options before the field after their trigger for Shift+Tab', async () => {
    const user = await openMenu();

    act(() => button('Delete Item').focus());
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await user.tab({ shift: true });
    expect(option('Oldest')).toHaveFocus();
  });

  it('wraps from its last Tab stop to its first when the menu is the last thing in it', async () => {
    const user = userEvent.setup();
    const Last = () => {
      const [sort, setSort] = useState('newest');
      return (
        <ModalPage
          content={
            <Select
              value={sort}
              onChange={setSort}
              options={[{ value: 'newest', label: 'Newest' }]}
              ariaLabel="Sort by"
            />
          }
        />
      );
    };
    render(<Last />);
    await user.click(button('Open'));
    await user.tab();
    await user.keyboard('{Enter}');

    await user.tab();
    expect(option('Newest')).toHaveFocus();
    await user.tab();
    expect(button('Close modal')).toHaveFocus();

    // And back the other way, with the menu open again.
    await user.tab({ shift: true });
    expect(trigger()).toHaveFocus();
    await user.keyboard('{Enter}');
    act(() => button('Close modal').focus());
    await user.tab({ shift: true });
    expect(option('Newest')).toHaveFocus();
  });

  it("leaves the menu out of a confirmation's trap when one opens over the modal", async () => {
    const user = await openMenu();

    // Opened from the keyboard, so the menu stays open behind it.
    act(() => button('Delete Item').focus());
    await user.keyboard('{Enter}');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    const confirmation = within(screen.getByRole('alertdialog'));

    expect(confirmation.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.tab();
    expect(confirmation.getByRole('button', { name: 'Delete' })).toHaveFocus();
    await user.tab();
    expect(confirmation.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(confirmation.getByRole('button', { name: 'Delete' })).toHaveFocus();
  });
});
