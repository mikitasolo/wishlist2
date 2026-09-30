// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { render, screen, act, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';
import BaseModal from '@/components/BaseModal';
import ConfirmDialog from '@/components/ConfirmDialog';

// useBodyScrollLock restores the scroll position on close; jsdom lacks scrollTo.
beforeAll(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterAll(() => vi.restoreAllMocks());
beforeEach(() => cleanup());

/**
 * A page with a button that opens the modal and another one behind it. The
 * modal's "Delete Item" opens a confirmation rendered beside it, as the item
 * modals do.
 */
function ModalPage({ content }: { content?: ReactNode }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  return (
    <>
      <button onClick={() => setModalOpen(true)}>Open</button>
      <button>Behind</button>
      <BaseModal
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
