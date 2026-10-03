// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

type User = { id: string; email: string; username: string };

const { signedIn } = vi.hoisted(() => ({
  // Mutable, so a test can sign out (`user: null`) or put the session through
  // an `update()` (`loading`). Set in beforeEach.
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

const fetchMock = vi.fn();

beforeEach(() => {
  cleanup();
  signedIn.user = me;
  signedIn.loading = false;
  setTheme.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// regression: a pending invite lit a red dot on the avatar, as well as the
// bell's count, and the menu had an Invitations item: three signals that didn't
// clear each other, the dot and the badge alike on a phone. Invitations live
// in Activity now, and the bell is the one signal (D3, WIS-250).
describe('AuthButton — no invitation signal of its own', () => {
  it('regression: shows no dot on the avatar, and never reads the invitations', async () => {
    const { container } = render(<AuthButton />);
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('invites-changed'));
    });

    expect(screen.getByRole('button', { name: 'Account menu' })).toBeInTheDocument();
    expect(container.querySelector('.bg-danger-fill')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('regression: has no Invitations item, and opening it reads nothing', async () => {
    render(<AuthButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }));

    await screen.findByRole('menuitem', { name: 'Settings' });
    expect(screen.queryByRole('menuitem', { name: /invitations/i })).toBeNull();
    expect(document.querySelector('a[href="/invites"]')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('AuthButton — signing out', () => {
  afterEach(() => window.history.replaceState(null, '', '/'));

  async function signOutFrom(url: string) {
    window.history.replaceState(null, '', url);
    render(<AuthButton />);
    fireEvent.click(screen.getByRole('button', { name: /^account menu$/i }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Sign out' }));
  }

  // regression (WIS-251 review): signOut reloads the page before the session
  // reads as signed out, so the hint was never cleared and the next load held
  // the signed-in header's shape, then jumped to Sign in.
  it('regression: forgets the session hint before signing out', async () => {
    localStorage.setItem('session-hint', '1');
    document.documentElement.setAttribute('data-session-hint', '');
    let hintWhenSignedOut: string | null = 'unread';
    vi.mocked(signOut).mockImplementationOnce(async () => {
      hintWhenSignedOut = localStorage.getItem('session-hint');
      return undefined as never;
    });
    await signOutFrom('/');
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(hintWhenSignedOut).toBeNull();
    expect(document.documentElement).not.toHaveAttribute('data-session-hint');
  });

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
      'Settings',
      'Sign out',
    ]);
  });

  it('moves with the arrow keys, Home and End, through the theme choice too', async () => {
    const user = await openFromKeyboard();
    await user.keyboard('{ArrowDown}');
    expect(item('Settings')).toHaveFocus();
    await user.keyboard('{ArrowDown}');
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
    expect(item('Settings')).toHaveAttribute('href', '/settings');
  });

  it('signs out from the keyboard', async () => {
    const user = await openFromKeyboard();
    await user.keyboard('{End}{Enter}');
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});

// WIS-251: pages you go to are in the navigation (Home, Reserved, Activity,
// Me), so the account menu keeps only the account's own things (D3).
describe('AuthButton — what the account menu holds', () => {
  const accountButton = () => screen.getByRole('button', { name: /^account menu/i });

  it('has exactly your profile, Settings, the theme and Sign out', async () => {
    render(<AuthButton />);
    fireEvent.click(accountButton());
    const menu = await screen.findByRole('menu', { name: 'Account' });

    const entries = [...menu.querySelectorAll('[role="menuitem"], [role="group"]')].map((el) =>
      el.getAttribute('role') === 'group' ? el.getAttribute('aria-label') : el.textContent
    );
    expect(entries).toEqual(['Your profile', 'Settings', 'Theme', 'Sign out']);
    expect(screen.queryByRole('menuitem', { name: /reserved/i })).toBeNull();
    expect(document.querySelector('a[href="/booked"]')).toBeNull();
    expect(document.querySelector('a[href="/notifications"]')).toBeNull();
  });

  it("shows its owner's own email in its header, and the avatar alone on the button", async () => {
    render(<AuthButton />);
    expect(accountButton()).not.toHaveTextContent('mikita');
    fireEvent.click(accountButton());
    expect(await screen.findByText('@mikita')).toBeInTheDocument();
    expect(screen.getByText('me@example.com')).toBeInTheDocument();
  });

  it('has no profile item for an account with no username yet', async () => {
    signedIn.user = { ...me, username: '' };
    render(<AuthButton />);
    fireEvent.click(accountButton());
    await screen.findByRole('menuitem', { name: 'Settings' });
    expect(screen.getAllByRole('menuitem').map((el) => el.textContent)).toEqual([
      'Settings',
      'Sign out',
    ]);
  });

  // regression (WIS-209): while the session loaded the button was a bare 40px
  // circle, and the account button that replaced it was wider, so the header's
  // buttons jumped sideways on every page load.
  it('regression: holds both shapes, hidden from assistive tech, while the session loads', () => {
    signedIn.user = null;
    signedIn.loading = true;
    const { container } = render(<AuthButton />);

    expect(screen.queryByRole('button')).toBeNull();
    const placeholder = container.firstElementChild!;
    expect(placeholder).toHaveAttribute('aria-hidden', 'true');
    // The account button's shape under the session hint, Sign in's otherwise.
    expect(placeholder.querySelector('.session-hint\\:flex')).not.toBeNull();
    expect(placeholder.querySelector('.session-hint\\:hidden')).toHaveTextContent('Sign in');
  });

  it('keeps the menu up while a known session is updated', () => {
    signedIn.loading = true;
    render(<AuthButton />);
    expect(accountButton()).toBeInTheDocument();
  });
});
