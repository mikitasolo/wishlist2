// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

type User = { id: string; email: string; username: string };

const { signedIn } = vi.hoisted(() => ({
  // Mutable, so a test can sign another account in, sign out (`user: null`), or
  // put the session through an `update()` (`loading`) while the header is up.
  // Set in beforeEach.
  signedIn: { user: null as User | null, loading: false },
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: signedIn.user && { user: signedIn.user },
    status: signedIn.loading ? 'loading' : signedIn.user ? 'authenticated' : 'unauthenticated',
  }),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

const { setTheme } = vi.hoisted(() => ({ setTheme: vi.fn() }));
vi.mock('@/components/ThemeProvider', () => ({
  useTheme: () => ({ theme: 'light', setTheme }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { signOut } from 'next-auth/react';
import AuthButton from '@/components/AuthButton';
import { AUTH_ONLY_PATHS } from '@/lib/utils/callbackUrl';

const me: User = { id: 'me', email: 'me@example.com', username: 'mikita' };
const someoneElse: User = { id: 'someone-else', email: 'else@example.com', username: 'someone' };

/** The invite list answering with `count` pending invites. */
function inviteList(count: number) {
  const data = Array.from({ length: count }, (_, i) => ({ _id: `inv-${i}` }));
  return { json: async () => ({ success: true, data }) };
}

function mockInvites(count: number) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(inviteList(count)));
}

/** Holds every invite check open until the test answers it. */
function holdChecks() {
  const checks: ((count: number) => void)[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise((resolve) => {
          checks.push((count) => resolve(inviteList(count)));
        })
    )
  );
  return {
    /** How many checks the header has sent. */
    sent: () => checks.length,
    /** Answers the `n`th check, counting from 0, with `count` pending invites. */
    answer: async (n: number, count: number) => {
      if (n >= checks.length) throw new Error(`check ${n} was never sent (${checks.length} were)`);
      await act(async () => checks[n](count));
    },
  };
}

const dot = () => screen.queryByRole('button', { name: /new invitations/i });

beforeEach(() => {
  cleanup();
  signedIn.user = me;
  signedIn.loading = false;
  setTheme.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('AuthButton — pending-invitation dot', () => {
  // Regression: the header must surface pending invitations with a dot.
  it('regression: marks the menu button when invitations are pending', async () => {
    mockInvites(2);
    render(<AuthButton />);
    // aria-label gains "— new invitations" when the dot is shown.
    expect(await screen.findByRole('button', { name: /new invitations/i })).toBeInTheDocument();
  });

  it('shows no indicator when there are no invitations', async () => {
    mockInvites(0);
    render(<AuthButton />);
    // Give the mount fetch a tick to resolve.
    await act(async () => {
      await Promise.resolve();
    });
    expect(dot()).toBeNull();
    expect(screen.getByRole('button', { name: /^account menu$/i })).toBeInTheDocument();
  });

  // Regression: acting on invites elsewhere fires `invites-changed` so the dot
  // updates without a reload/navigation.
  it('regression: refreshes the dot on the invites-changed event', async () => {
    mockInvites(0);
    render(<AuthButton />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(dot()).toBeNull();

    mockInvites(1);
    await act(async () => {
      window.dispatchEvent(new Event('invites-changed'));
    });
    expect(await screen.findByRole('button', { name: /new invitations/i })).toBeInTheDocument();
  });

  // regression: every check's answer was applied as it landed, so an older one
  // landing late overwrote what a newer one had found.
  it('ignores a check that lands after a newer one', async () => {
    const { answer } = holdChecks();
    render(<AuthButton />);
    await answer(0, 0);

    act(() => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('invites-changed'));
    });
    // The newer check finds an invitation, and the older one, landing after it,
    // changes nothing.
    await answer(2, 1);
    expect(dot()).not.toBeNull();
    await answer(1, 0);
    expect(dot()).not.toBeNull();
  });
});

describe('AuthButton — the account changing', () => {
  // regression: the dot was checked in an effect keyed on the session status
  // alone. Another account signing in from another tab leaves the status
  // 'authenticated', so the effect didn't re-run, and the dot kept showing the
  // previous account's invitations until the next focus or `invites-changed`.
  it("regression: re-checks the dot, and never shows the previous account's for the new one", async () => {
    const { sent, answer } = holdChecks();
    const { rerender } = render(<AuthButton />);
    await answer(0, 2);
    expect(dot()).not.toBeNull();

    signedIn.user = someoneElse;
    rerender(<AuthButton />);

    // The previous account's dot is gone at once, while the new account's
    // check is on its way...
    expect(screen.getByText('someone')).toBeInTheDocument();
    expect(dot()).toBeNull();
    expect(screen.getByRole('button', { name: /^account menu$/i })).toBeInTheDocument();
    expect(sent()).toBe(2);

    // ...and the new account's own answer decides it.
    await answer(1, 1);
    expect(dot()).not.toBeNull();
  });

  // regression: a check sent for the previous account, landing after the
  // switch, put up the previous account's dot for the new one.
  it("a check for the previous account landing late doesn't show its dot", async () => {
    const { sent, answer } = holdChecks();
    const { rerender } = render(<AuthButton />);
    await answer(0, 0);

    // A check for the previous account is still on its way when the account changes.
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    signedIn.user = someoneElse;
    rerender(<AuthButton />);
    expect(sent()).toBe(3);

    // It finds the previous account's invitations, before the new account's check lands...
    await answer(1, 3);
    expect(dot()).toBeNull();
    // ...which finds none of its own.
    await answer(2, 0);
    expect(dot()).toBeNull();
  });

  // regression: the same late answer, finding none, cleared the dot the new
  // account's own check had just put up.
  it("a check for the previous account landing late doesn't clear the new account's dot", async () => {
    const { answer } = holdChecks();
    const { rerender } = render(<AuthButton />);
    await answer(0, 0);

    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    signedIn.user = someoneElse;
    rerender(<AuthButton />);

    // The new account's check lands first and finds an invitation...
    await answer(2, 1);
    expect(dot()).not.toBeNull();
    // ...and the previous account's, landing after it with none, changes nothing.
    await answer(1, 0);
    expect(dot()).not.toBeNull();
  });

  // regression: a check sent before signing out, landing after signing back
  // in, put up what it had found then.
  it('signing out hides the dot, and a check from before it stays dropped after signing back in', async () => {
    const { sent, answer } = holdChecks();
    const { rerender } = render(<AuthButton />);
    await answer(0, 2);
    expect(dot()).not.toBeNull();

    // A check is still on its way when the account signs out.
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    signedIn.user = null;
    rerender(<AuthButton />);
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();

    // Signing back in shows no dot until a check sent since has landed...
    signedIn.user = me;
    rerender(<AuthButton />);
    expect(dot()).toBeNull();
    expect(sent()).toBe(3);

    // ...the one from before signing out, landing late, changes nothing...
    await answer(1, 2);
    expect(dot()).toBeNull();
    // ...and the one sent after signing back in decides it.
    await answer(2, 1);
    expect(dot()).not.toBeNull();
  });

  it('keeps the dot through a session update, which keeps the account', async () => {
    const { sent, answer } = holdChecks();
    const { rerender } = render(<AuthButton />);
    await answer(0, 2);
    expect(dot()).not.toBeNull();

    // `update()` (settings, welcome) puts the session through 'loading'.
    signedIn.loading = true;
    rerender(<AuthButton />);
    signedIn.loading = false;
    rerender(<AuthButton />);

    // The dot is still up, and a fresh check is on its way.
    expect(dot()).not.toBeNull();
    expect(sent()).toBe(2);
    await answer(1, 0);
    expect(dot()).toBeNull();
  });
});

describe('AuthButton — signing out', () => {
  afterEach(() => window.history.replaceState(null, '', '/'));

  async function signOutFrom(url: string) {
    window.history.replaceState(null, '', url);
    mockInvites(0);
    render(<AuthButton />);
    fireEvent.click(screen.getByRole('button', { name: /^account menu$/i }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Sign out' }));
  }

  // A page that needs an account sends a signed-out visitor to sign in, so
  // reloading it once signed out would land on the sign-in form.
  it.each([...AUTH_ONLY_PATHS])('goes home from %s, a page that needs an account', async (path) => {
    await signOutFrom(`${path}?x=1#top`);
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledWith({ redirectTo: '/' });
  });

  it.each(['/', '/wishlists/abc123', '/users/alice', '/wishlists/mine-too', '/items/x'])(
    'stays on %s, a page anyone can open',
    async (path) => {
      await signOutFrom(`${path}?tab=items`);
      expect(signOut).toHaveBeenCalledTimes(1);
      expect(signOut).toHaveBeenCalledWith(undefined);
    }
  );
});

// WIS-220: the account menu is the shared Menu, so it works from the keyboard.
describe('AuthButton — the account menu from the keyboard', () => {
  const accountButton = () => screen.getByRole('button', { name: /^account menu/i });
  const menu = () => screen.queryByRole('menu', { name: 'Account' });
  const item = (name: string) => screen.getByRole('menuitem', { name });
  const radio = (name: string) => screen.getByRole('menuitemradio', { name });

  async function openFromKeyboard() {
    mockInvites(0);
    const user = userEvent.setup();
    render(<AuthButton />);
    await act(async () => {
      await Promise.resolve();
    });
    act(() => accountButton().focus());
    await user.keyboard('{Enter}');
    return user;
  }

  it('opens on its first item, with the header (the account and its email) above the items', async () => {
    await openFromKeyboard();
    expect(menu()).toBeInTheDocument();
    expect(item('Your profile')).toHaveFocus();
    expect(screen.getByText('me@example.com')).toBeVisible();
    expect(menu()).not.toContainElement(screen.getByText('me@example.com'));
    expect(screen.getAllByRole('menuitem').map((el) => el.textContent)).toEqual([
      'Your profile',
      'Reserved by you',
      'Invitations',
      'Settings',
      'Sign out',
    ]);
  });

  it('moves with the arrow keys, Home and End, through the theme choice too', async () => {
    const user = await openFromKeyboard();
    await user.keyboard('{ArrowDown}');
    expect(item('Reserved by you')).toHaveFocus();
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
    expect(radio('Light')).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(radio('Dark')).toHaveFocus();
    await user.keyboard('{End}');
    expect(item('Sign out')).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(item('Your profile')).toHaveFocus();
    await user.keyboard('{Home}{ArrowUp}');
    expect(item('Sign out')).toHaveFocus();
  });

  // regression: every item was a Tab stop, so Tab walked through the menu and
  // on into the page behind it with the menu still open.
  it('regression: makes no item a Tab stop', async () => {
    await openFromKeyboard();
    for (const el of [
      ...screen.getAllByRole('menuitem'),
      ...screen.getAllByRole('menuitemradio'),
    ]) {
      expect(el).toHaveAttribute('tabindex', '-1');
    }
  });

  // regression: Escape closed it with focus dropped to <body>.
  it('regression: closes with Escape, with focus back on the Account menu button', async () => {
    const user = await openFromKeyboard();
    await user.keyboard('{ArrowDown}{ArrowDown}');
    await user.keyboard('{Escape}');
    expect(menu()).toBeNull();
    expect(accountButton()).toHaveFocus();
    expect(accountButton()).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes with Tab, with focus back on the Account menu button to move on from', async () => {
    await openFromKeyboard();
    fireEvent.keyDown(item('Your profile'), { key: 'Tab' });
    expect(menu()).toBeNull();
    expect(accountButton()).toHaveFocus();
  });

  it('says which theme is on, and changes it from the keyboard, staying open', async () => {
    const user = await openFromKeyboard();
    expect(screen.getByRole('group', { name: 'Theme' })).toContainElement(radio('Light'));
    expect(radio('Light')).toHaveAttribute('aria-checked', 'true');
    expect(radio('Dark')).toHaveAttribute('aria-checked', 'false');

    await user.keyboard('d');
    expect(radio('Dark')).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(setTheme).toHaveBeenCalledExactlyOnceWith('dark');
    expect(menu()).toBeInTheDocument();
  });

  it('links each page item to its page', async () => {
    await openFromKeyboard();
    expect(item('Your profile')).toHaveAttribute('href', '/users/mikita');
    expect(item('Reserved by you')).toHaveAttribute('href', '/booked');
    expect(item('Invitations')).toHaveAttribute('href', '/invites');
    expect(item('Settings')).toHaveAttribute('href', '/settings');
  });

  it('signs out from the keyboard', async () => {
    const user = await openFromKeyboard();
    await user.keyboard('{End}{Enter}');
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('re-checks the invitations when it opens', async () => {
    await openFromKeyboard();
    // Once on sign-in, once on opening.
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
