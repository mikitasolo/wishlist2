// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { render, screen, act, cleanup, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { emulateFocusFixup } from '../focusFixup';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: 'u1', defaultCurrency: 'USD' } } }),
}));
const showToast = vi.fn();
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));
// ImageUpload pulls in react-easy-crop, and its hidden file input would be a
// Tab stop in jsdom, which applies no CSS; a button stands in for it.
vi.mock('@/components/ImageUpload', () => ({
  default: ({ disabled }: { disabled?: boolean }) => (
    <button type="button" disabled={disabled}>
      Upload banner
    </button>
  ),
}));

import CreateWishlistModal from '@/components/CreateWishlistModal';

// useBodyScrollLock restores the scroll position on close; jsdom lacks scrollTo.
beforeAll(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterAll(() => vi.restoreAllMocks());
beforeEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
// Fail on anything logged: a React warning, or an error while moving focus.
beforeEach(() => {
  const consoleError = vi.spyOn(console, 'error');
  return () => {
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  };
});

/** A page with the button that opens the modal, and another one behind it. */
function CreatePage() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>New wishlist</button>
      <button>Behind</button>
      <CreateWishlistModal isOpen={open} onClose={() => setOpen(false)} />
    </>
  );
}

const button = (name: string | RegExp) => screen.getByRole('button', { name });
const modal = () => screen.getByRole('dialog', { name: 'Create new wishlist' });
const nameField = () => screen.getByLabelText(/wishlist name/i);
const currency = () => button('Wishlist currency');
const option = (name: string | RegExp) => screen.getByRole('option', { name });
const menu = () => screen.queryByRole('listbox');

async function openModal() {
  const user = userEvent.setup();
  render(<CreatePage />);
  await user.click(button('New wishlist'));
  return user;
}

type User = ReturnType<typeof userEvent.setup>;

/** Tabs from the name field to the currency trigger. */
async function tabToCurrency(user: User) {
  expect(nameField()).toHaveFocus();
  await user.tab();
  expect(screen.getByLabelText('Description')).toHaveFocus();
  await user.tab();
  expect(currency()).toHaveFocus();
}

describe('CreateWishlistModal — keyboard focus', () => {
  it('moves focus to the name field when it opens', async () => {
    await openModal();

    expect(nameField()).toHaveFocus();
  });

  // regression: the modal had no focus trap, so Tab and Shift+Tab walked out of
  // it to the page behind its backdrop.
  it('regression: keeps Tab and Shift+Tab inside, wrapping at both ends', async () => {
    const user = await openModal();

    act(() => button('Create Wishlist').focus());
    await user.tab();
    expect(button('Close modal')).toHaveFocus();
    await user.tab({ shift: true });
    expect(button('Create Wishlist')).toHaveFocus();
    expect(modal()).toBeInTheDocument();
  });

  // regression: closing the modal left focus on <body> (where its focused
  // control had dropped it), not on the button that opened it.
  it.each([
    { how: 'Escape', close: (user: User) => user.keyboard('{Escape}') },
    { how: 'the close button', close: (user: User) => user.click(button('Close modal')) },
    { how: 'Cancel', close: (user: User) => user.click(button('Cancel')) },
  ])(
    'regression: returns focus to the button that opened it when closed with $how',
    async ({ close }) => {
      const user = await openModal();
      expect(nameField()).toHaveFocus();

      await close(user);
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(button('New wishlist')).toHaveFocus();
    }
  );

  it('traps focus in the discard confirmation over it, then in itself again', async () => {
    const user = await openModal();
    await user.type(nameField(), 'Birthday');
    // Off the typed field first: user-event fires its `change` on blur, and the
    // confirmation taking focus would fire it in the middle of React's commit.
    await user.tab();
    const description = screen.getByLabelText('Description');
    expect(description).toHaveFocus();

    await user.keyboard('{Escape}');
    const confirmation = within(screen.getByRole('alertdialog', { name: 'Discard Changes?' }));
    expect(confirmation.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.tab();
    expect(confirmation.getByRole('button', { name: 'Discard' })).toHaveFocus();
    await user.tab();
    expect(confirmation.getByRole('button', { name: 'Cancel' })).toHaveFocus();

    // Keep editing: focus goes back to the field Escape was pressed in, and
    // the modal traps Tab again.
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(description).toHaveFocus();
    act(() => button('Close modal').focus());
    await user.tab({ shift: true });
    expect(button('Create Wishlist')).toHaveFocus();

    // Discard: both close, and focus goes back to the page.
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button('New wishlist')).toHaveFocus();
  });
});

describe('CreateWishlistModal — the currency Select by keyboard', () => {
  // regression: the Select's menu is portalled to <body>, outside the modal, so
  // Tab from its trigger went on to the next field and the options could only
  // be reached by tabbing past everything else on the page.
  it('regression: opens the menu with Enter, reaches its options with Tab and chooses one with Enter', async () => {
    const user = await openModal();
    await tabToCurrency(user);
    expect(currency()).toHaveTextContent('USD · US Dollar');

    await user.keyboard('{Enter}');
    expect(menu()).toBeInTheDocument();
    expect(currency()).toHaveFocus();

    await user.tab();
    expect(option('USD · US Dollar')).toHaveFocus();
    await user.tab();
    expect(option('EUR · Euro')).toHaveFocus();
    await user.keyboard('{Enter}');

    // regression: choosing removed the focused option with the menu, which
    // dropped focus to <body>; it goes back to the trigger.
    expect(menu()).toBeNull();
    expect(currency()).toHaveTextContent('EUR · Euro');
    expect(currency()).toHaveFocus();

    // Tab carries on from there, inside the modal.
    await user.tab();
    expect(button('Upload banner')).toHaveFocus();
    expect(modal()).toBeInTheDocument();
  });

  it('regression: walks back from the menu to its trigger, and on from its last option to the next field', async () => {
    const user = await openModal();
    await tabToCurrency(user);
    await user.keyboard('{Enter}');
    const options = screen.getAllByRole('option');

    await user.tab();
    expect(options[0]).toHaveFocus();
    await user.tab({ shift: true });
    expect(currency()).toHaveFocus();

    for (let i = 0; i < options.length; i++) await user.tab();
    expect(options[options.length - 1]).toHaveFocus();
    await user.tab();
    expect(button('Upload banner')).toHaveFocus();

    // Leaving the menu closes it, rather than leave it open over the fields
    // after it, so Shift+Tab goes straight back to the trigger.
    expect(menu()).toBeNull();
    expect(currency()).toHaveTextContent('USD · US Dollar');
    await user.tab({ shift: true });
    expect(currency()).toHaveFocus();
  });

  it('keeps Tab inside the modal with the menu open, wrapping past it at both ends', async () => {
    const user = await openModal();
    await tabToCurrency(user);
    await user.keyboard('{Enter}');
    const options = screen.getAllByRole('option');

    // From the last field, Tab wraps to the close button, not into the page.
    act(() => button('Create Wishlist').focus());
    await user.tab();
    expect(button('Close modal')).toHaveFocus();
    await user.tab({ shift: true });
    expect(button('Create Wishlist')).toHaveFocus();
    expect(menu()).toBeInTheDocument();

    // The menu sits between its trigger and the next field.
    act(() => button('Upload banner').focus());
    await user.tab({ shift: true });
    expect(options[options.length - 1]).toHaveFocus();
  });

  it('chooses an option with the mouse and leaves focus on the trigger, so Tab carries on from there', async () => {
    const user = await openModal();

    await user.click(currency());
    await user.click(option('PLN · Polish Zloty'));
    expect(menu()).toBeNull();
    expect(currency()).toHaveTextContent('PLN · Polish Zloty');
    expect(currency()).toHaveFocus();

    await user.tab();
    expect(button('Upload banner')).toHaveFocus();
  });

  it('returns focus to the opener when the modal closes after choosing a currency', async () => {
    const user = await openModal();
    await tabToCurrency(user);
    await user.keyboard('{Enter}');
    await user.tab();
    await user.tab();
    await user.keyboard('{Enter}');
    expect(currency()).toHaveTextContent('EUR · Euro');
    expect(currency()).toHaveFocus();

    // On past the banner and the three visibility choices.
    await user.tab();
    await user.tab();
    await user.tab();
    await user.tab();
    await user.tab();
    expect(button('Cancel')).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button('New wishlist')).toHaveFocus();
  });
});

describe('CreateWishlistModal — keyboard focus while it creates the wishlist', () => {
  // A disabled control drops focus to <body>, as in a browser.
  beforeEach(() => emulateFocusFixup());

  /** A create request that stays in flight until the test answers it. */
  function pendingCreate() {
    let answer!: (body: unknown) => void;
    const fetchMock = vi.fn(
      () =>
        new Promise((resolve) => {
          answer = (body) => resolve({ json: async () => body });
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    return { fetchMock, answer: (body: unknown) => act(async () => answer(body)) };
  }

  async function startCreating() {
    const create = pendingCreate();
    const user = await openModal();
    // Filled without typing: user-event fires `change` (in an act) when a
    // field it saw edited loses focus, which here is inside React's commit.
    fireEvent.change(nameField(), { target: { value: 'Birthday' } });
    await user.keyboard('{Enter}');
    expect(create.fetchMock).toHaveBeenCalledTimes(1);
    expect(nameField()).toBeDisabled();
    return { user, ...create };
  }

  // regression: submitting disabled every control, the focused name field
  // with them, which dropped focus to <body> behind the backdrop; after a
  // failure it stayed there.
  it('regression: holds focus on the modal while it submits, then hands it back to the name field after a failure', async () => {
    const { user, answer } = await startCreating();

    expect(modal()).toHaveFocus();
    await user.tab();
    expect(modal()).toHaveFocus();

    await answer({ success: false, error: 'Something went wrong' });
    expect(showToast).toHaveBeenCalledWith('Something went wrong', 'error');
    expect(nameField()).toBeEnabled();
    expect(nameField()).toHaveFocus();
  });

  it('hands focus back to the opener when the wishlist is created', async () => {
    const { answer } = await startCreating();

    await answer({ success: true, data: { _id: 'w1', slug: 'birthday' } });
    expect(push).toHaveBeenCalledWith('/wishlists/birthday');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button('New wishlist')).toHaveFocus();
  });
});
