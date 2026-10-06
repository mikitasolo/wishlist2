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
const currency = () => screen.getByRole('combobox', { name: 'Wishlist currency' });
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
  expect(screen.getByRole('combobox', { name: 'Occasion' })).toHaveFocus();
  await user.tab();
  expect(screen.getByRole('radio', { name: 'Public' })).toHaveFocus();
  await user.tab();
  expect(button('More options')).toHaveFocus();
  await user.keyboard('{Enter}');
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

    act(() => button('Create wishlist').focus());
    await user.tab();
    expect(button('Close modal')).toHaveFocus();
    await user.tab({ shift: true });
    expect(button('Create wishlist')).toHaveFocus();
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
    const description = screen.getByRole('combobox', { name: 'Occasion' });
    expect(description).toHaveFocus();

    await user.keyboard('{Escape}');
    const confirmation = within(screen.getByRole('alertdialog', { name: 'Discard changes?' }));
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
    expect(button('Create wishlist')).toHaveFocus();

    // Discard: both close, and focus goes back to the page.
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button('New wishlist')).toHaveFocus();
  });
});

describe('CreateWishlistModal — on BaseModal', () => {
  it('is a md-wide dialog with Cancel and Create wishlist in its pinned footer', async () => {
    await openModal();
    expect(modal()).toHaveClass('max-w-md');
    expect(modal().tagName).toBe('FORM');
    const cancel = button('Cancel');
    const bar = cancel.parentElement!;
    expect(bar).toContainElement(button('Create wishlist'));
    expect(bar).not.toContainElement(nameField());
    expect(button('Create wishlist')).toHaveAttribute('type', 'submit');
  });

  // regression: the discard confirmation, no longer inside the modal's portal,
  // rendered where the modal sits: in the header, whose frosted bar contains a
  // fixed overlay, it was drawn inside the bar, under the modal's backdrop.
  it('regression: puts the discard confirmation on <body>, like the modal itself', async () => {
    const user = await openModal();
    await user.type(nameField(), 'Birthday');
    await user.tab();
    await user.keyboard('{Escape}');
    const confirmation = screen.getByRole('alertdialog', { name: 'Discard changes?' });
    expect(confirmation.parentElement!.parentElement).toBe(document.body);
    expect(modal().parentElement!.parentElement).toBe(document.body);
  });
});

describe('CreateWishlistModal — the currency Select by keyboard', () => {
  /** The option the keyboard is on, as the trigger announces it. */
  const activeOption = () =>
    document.getElementById(currency().getAttribute('aria-activedescendant') ?? '');

  // regression: the Select's menu is portalled to <body>, outside the modal, so
  // the keyboard couldn't reach its options from the trigger.
  it('regression: opens the menu with Enter on the selected currency, moves with the arrows and chooses with Enter', async () => {
    const user = await openModal();
    await tabToCurrency(user);
    expect(currency()).toHaveTextContent('USD · US Dollar');

    await user.keyboard('{Enter}');
    expect(menu()).toBeInTheDocument();
    expect(activeOption()).toBe(option('USD · US Dollar'));
    expect(currency()).toHaveFocus();

    await user.keyboard('{ArrowDown}');
    expect(activeOption()).toBe(option('EUR · Euro'));
    expect(currency()).toHaveFocus();
    await user.keyboard('{Enter}');

    // regression: choosing removed the focused option with the menu, which
    // dropped focus to <body>; it stays on the trigger.
    expect(menu()).toBeNull();
    expect(currency()).toHaveTextContent('EUR · Euro');
    expect(currency()).toHaveFocus();

    // Tab carries on from there, inside the modal.
    await user.tab();
    expect(button('Upload banner')).toHaveFocus();
    expect(modal()).toBeInTheDocument();
  });

  it('jumps to a currency by typing its code', async () => {
    const user = await openModal();
    await tabToCurrency(user);

    await user.keyboard('gb');
    expect(activeOption()).toBe(option('GBP · British Pound'));
    await user.keyboard('{Enter}');
    expect(currency()).toHaveTextContent('GBP · British Pound');
    expect(currency()).toHaveFocus();
  });

  it('closes the menu without choosing on Tab or Shift+Tab, which move on inside the modal', async () => {
    const user = await openModal();
    await tabToCurrency(user);
    await user.keyboard('{Enter}{End}');

    await user.tab();
    expect(button('Upload banner')).toHaveFocus();
    expect(menu()).toBeNull();
    expect(currency()).toHaveTextContent('USD · US Dollar');

    await user.tab({ shift: true });
    expect(currency()).toHaveFocus();
    await user.keyboard('{Enter}');
    await user.tab({ shift: true });
    expect(screen.getByLabelText('Description')).toHaveFocus();
    expect(menu()).toBeNull();
    expect(modal()).toBeInTheDocument();
  });

  // regression: the menu and the modal both closed on Escape through keydown
  // listeners on `document`, and neither stopped the other.
  it('regression: closes only the menu on Escape, and the next Escape closes the modal', async () => {
    const user = await openModal();
    await tabToCurrency(user);
    await user.keyboard('{Enter}{ArrowDown}');

    await user.keyboard('{Escape}');
    expect(menu()).toBeNull();
    expect(modal()).toBeInTheDocument();
    expect(currency()).toHaveTextContent('USD · US Dollar');
    expect(currency()).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button('New wishlist')).toHaveFocus();
  });

  it('regression: with a name typed, Escape on the open menu closes it without asking to discard', async () => {
    const user = await openModal();
    await user.type(nameField(), 'Birthday');
    await tabToCurrency(user);
    await user.keyboard('{Enter}');

    await user.keyboard('{Escape}');
    expect(menu()).toBeNull();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(currency()).toHaveFocus();

    // The next Escape is the modal's, which asks first.
    await user.keyboard('{Escape}');
    expect(screen.getByRole('alertdialog', { name: 'Discard changes?' })).toBeInTheDocument();
  });

  it('chooses an option with the mouse and leaves focus on the trigger, so Tab carries on from there', async () => {
    const user = await openModal();

    await user.click(button('More options'));
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
    await user.keyboard('{Enter}{ArrowDown}{Enter}');
    expect(currency()).toHaveTextContent('EUR · Euro');
    expect(currency()).toHaveFocus();

    // On past the banner.
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

describe('CreateWishlistModal — the new order', () => {
  const sentBody = (fetchMock: ReturnType<typeof vi.fn>) =>
    JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
  const created = () =>
    vi.fn(async () => ({ json: async () => ({ success: true, data: { _id: 'w1', slug: 's' } }) }));

  it('asks for Name, Occasion and Visibility first, with the rest under More options', async () => {
    await openModal();
    const occasion = screen.getByRole('combobox', { name: 'Occasion' });
    const visibility = screen.getByRole('radiogroup', { name: 'Visibility' });
    const follows = (a: Node, b: Node) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(nameField(), occasion)).toBe(true);
    expect(follows(occasion, visibility)).toBe(true);
    expect(follows(visibility, button('More options'))).toBe(true);
    expect(screen.getByRole('radio', { name: 'Invite only' })).toBeInTheDocument();
  });

  it('starts More options collapsed and expands it', async () => {
    const user = await openModal();
    expect(button('More options')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByLabelText('Description')).not.toBeVisible();
    expect(screen.queryByRole('combobox', { name: 'Wishlist currency' })).toBeNull();

    await user.click(button('More options'));
    expect(button('More options')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Description')).toBeVisible();
    expect(currency()).toBeVisible();
  });

  it('keeps Create in the footer, outside the scrolling body', async () => {
    await openModal();
    expect(button('Create wishlist').parentElement).toBe(button('Cancel').parentElement);
    expect(button('Create wishlist').parentElement).not.toContainElement(nameField());
  });

  it('sends no occasion as null', async () => {
    const fetchMock = created();
    vi.stubGlobal('fetch', fetchMock);
    const user = await openModal();
    fireEvent.change(nameField(), { target: { value: 'Anna' } });
    await user.click(button('Create wishlist'));
    expect(sentBody(fetchMock)).toMatchObject({
      name: 'Anna',
      visibility: 'everyone',
      occasion: null,
    });
  });

  it('opens on a Birthday occasion for the birthday nudge, its date left to pick (WIS-344)', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<CreateWishlistModal isOpen onClose={onClose} occasionKind="birthday" />);
    expect(screen.getByRole('combobox', { name: 'Occasion' })).toHaveTextContent('Birthday');
    expect(screen.queryByDisplayValue(/\d{4}-\d{2}-\d{2}/)).toBeNull();
    // Yearly, as picking Birthday by hand makes it, with no month or day picked:
    // a one-off birthday list would lapse after this year's.
    expect(screen.getByRole('combobox', { name: 'Occasion month' })).not.toHaveTextContent(
      /January|February|March|April|May|June|July|August|September|October|November|December/
    );
    expect(screen.getByRole('combobox', { name: 'Occasion day' })).toBeInTheDocument();
    // The prefill is where the form starts, not a change to discard.
    await user.click(button('Cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('submits a yearly occasion as its day and month on the placeholder year', async () => {
    const fetchMock = created();
    vi.stubGlobal('fetch', fetchMock);
    const user = await openModal();
    fireEvent.change(nameField(), { target: { value: 'Anna' } });
    await user.click(screen.getByRole('combobox', { name: 'Occasion' }));
    await user.click(option('Birthday'));
    await user.click(screen.getByRole('combobox', { name: 'Occasion month' }));
    await user.click(option('March'));
    await user.click(screen.getByRole('combobox', { name: 'Occasion day' }));
    await user.click(option('14'));
    await user.click(button('Create wishlist'));
    expect(sentBody(fetchMock).occasion).toEqual({
      kind: 'birthday',
      date: '2000-03-14',
      recurrence: 'yearly',
    });
  });
});
