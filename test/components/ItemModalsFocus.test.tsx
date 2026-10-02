// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { render, screen, act, fireEvent, within, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ApiItem } from '@/types/api';
import { emulateFocusFixup } from '../focusFixup';

// ImageUpload pulls in react-easy-crop; stub it out.
vi.mock('@/components/ImageUpload', () => ({
  default: () => <div data-testid="image-upload" />,
}));

import AddItemModal from '@/components/AddItemModal';
import EditItemModal from '@/components/EditItemModal';
import ProposeItemModal from '@/components/ProposeItemModal';
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

type Submit = () => Promise<void>;
const currencies = { wishlistCurrency: 'USD', userCurrency: 'USD' };

// Every item modal saves its form through BaseModal's `isSubmitting`; run every
// case on each. The new-item ones start blank, so they need a name to submit,
// and the edit one sends only a change, so it's given a new name too.
const modals = [
  {
    name: 'AddItemModal',
    submitLabel: 'Add Item',
    submittingLabel: 'Adding...',
    needsName: true,
    renderModal: (onSubmit: Submit) =>
      render(<AddItemModal isOpen onClose={vi.fn()} onAdd={onSubmit} {...currencies} />),
  },
  {
    name: 'EditItemModal',
    submitLabel: 'Save Changes',
    submittingLabel: 'Saving...',
    needsName: true,
    renderModal: (onSubmit: Submit) =>
      render(
        <EditItemModal
          isOpen
          onClose={vi.fn()}
          onSave={onSubmit}
          item={item({ name: 'Old bike' })}
          {...currencies}
        />
      ),
  },
  {
    name: 'ProposeItemModal',
    submitLabel: 'Propose Item',
    submittingLabel: 'Proposing...',
    needsName: true,
    renderModal: (onSubmit: Submit) =>
      render(<ProposeItemModal isOpen onClose={vi.fn()} onPropose={onSubmit} {...currencies} />),
  },
  {
    name: 'ReviewItemModal',
    submitLabel: 'Approve Item',
    submittingLabel: 'Approving...',
    needsName: false,
    renderModal: (onSubmit: Submit) =>
      render(
        <ReviewItemModal
          isOpen
          onClose={vi.fn()}
          onApprove={onSubmit}
          item={item({ status: 'proposed' })}
          {...currencies}
        />
      ),
  },
];

// A submit handler that stays in flight until the test calls `fail`.
function pendingSubmit() {
  let fail!: () => void;
  const onSubmit = vi.fn(
    () =>
      new Promise<void>((_, reject) => {
        fail = () => reject(new Error('Something went wrong'));
      })
  );
  return { onSubmit, fail: () => act(async () => fail()) };
}

// The modals log the failure they catch; keep the test output clean, but fail
// on anything else logged (a React warning, an error while restoring focus).
function expectOnlyLogged(expected: string) {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  return () => {
    const logged = consoleError.mock.calls.map(([message]) => message);
    consoleError.mockRestore();
    expect(logged.filter((message) => message !== expected)).toEqual([]);
  };
}

// useBodyScrollLock restores the scroll position on close; jsdom lacks scrollTo.
beforeAll(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterAll(() => vi.restoreAllMocks());
beforeEach(() => cleanup());
// A disabled control drops focus to <body>, as in a browser.
beforeEach(() => emulateFocusFixup());

describe.each(modals)(
  '$name — keyboard focus while the form saves',
  ({ renderModal, submitLabel, submittingLabel, needsName }) => {
    beforeEach(() => expectOnlyLogged('Error submitting form:'));

    const modal = () => screen.getByRole('dialog');

    async function startSaving() {
      const user = userEvent.setup();
      const { onSubmit, fail } = pendingSubmit();
      renderModal(onSubmit);
      if (needsName) await user.type(screen.getByLabelText(/item name/i), 'Bike');
      await user.click(screen.getByRole('button', { name: submitLabel }));
      expect(screen.getByRole('button', { name: submittingLabel })).toBeDisabled();
      expect(onSubmit).toHaveBeenCalledTimes(1);
      return { user, fail };
    }

    // regression: saving disables the form's controls, and disabling the
    // focused submit button dropped focus to <body>, behind the backdrop, where
    // a screen reader lost its place.
    it('regression: holds focus on the modal while it saves', async () => {
      const { user } = await startSaving();

      expect(modal()).toHaveFocus();
      await user.tab();
      expect(modal()).toHaveFocus();
      await user.tab({ shift: true });
      expect(modal()).toHaveFocus();
    });

    // regression: after a failed save focus stayed on <body>, so Enter did
    // nothing and the next Tab landed on the close button, not the submit button.
    it('regression: hands focus back to the submit button when the save fails', async () => {
      const { user, fail } = await startSaving();

      await fail();
      expect(modal()).toBeInTheDocument();
      expect(screen.getByRole('button', { name: submitLabel })).toHaveFocus();

      // From there Tab carries on inside the modal, as before the save.
      await user.tab();
      expect(modal()).toContainElement(document.activeElement as HTMLElement);
    });

    it('hands focus back to the field Enter was pressed in when the save fails', async () => {
      const user = userEvent.setup();
      const { onSubmit, fail } = pendingSubmit();
      renderModal(onSubmit);
      const name = screen.getByLabelText(/item name/i);
      // Filled before it's focused: user-event fires `change` (in an act) when
      // a field it saw edited loses focus, which here is inside React's commit.
      if (needsName) fireEvent.change(name, { target: { value: 'Bike' } });

      await user.click(name);
      await user.keyboard('{Enter}');
      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(name).toBeDisabled();
      expect(modal()).toHaveFocus();

      await fail();
      expect(name).toBeEnabled();
      expect(name).toHaveFocus();
    });
  }
);

// Edit and Review disable the form while a delete runs too, through the same
// `isSubmitting`; the confirmation stacked over the modal holds focus then.
describe.each([
  {
    name: 'EditItemModal',
    renderModal: (onDelete: Submit) =>
      render(
        <EditItemModal
          isOpen
          onClose={vi.fn()}
          onSave={vi.fn()}
          onDelete={onDelete}
          item={item({})}
          {...currencies}
        />
      ),
  },
  {
    name: 'ReviewItemModal',
    renderModal: (onDelete: Submit) =>
      render(
        <ReviewItemModal
          isOpen
          onClose={vi.fn()}
          onApprove={vi.fn()}
          onDelete={onDelete}
          item={item({ status: 'proposed' })}
          {...currencies}
        />
      ),
  },
])('$name — keyboard focus while a delete runs', ({ renderModal }) => {
  beforeEach(() => expectOnlyLogged('Error deleting item:'));

  it('leaves focus on the confirmation, not the modal behind it', async () => {
    const user = userEvent.setup();
    const { onSubmit: onDelete, fail } = pendingSubmit();
    renderModal(onDelete);
    const deleteItem = screen.getByRole('button', { name: /^delete item$/i });

    await user.click(deleteItem);
    const confirmation = screen.getByRole('alertdialog');
    await user.click(within(confirmation).getByRole('button', { name: /^delete$/i }));
    expect(deleteItem).toBeDisabled();
    expect(confirmation).toHaveFocus();
    await user.tab();
    expect(confirmation).toHaveFocus();

    // A failed delete still hands focus back to Delete Item.
    await fail();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(deleteItem).toHaveFocus();
  });
});
