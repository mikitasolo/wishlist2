// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, cleanup, act } from '@testing-library/react';
import type { ReactNode } from 'react';

type User = { id: string; email: string; username?: string };

const { state } = vi.hoisted(() => ({
  state: {
    user: null as User | null,
    loading: false,
    pathname: '/',
  },
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: state.user && { user: state.user },
    status: state.loading ? 'loading' : state.user ? 'authenticated' : 'unauthenticated',
  }),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => state.pathname,
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
// The header's other parts have tests of their own; these are about its navigation.
vi.mock('@/components/GlobalSearch', () => ({ default: () => null }));
vi.mock('@/components/CreateWishlistModal', () => ({ default: () => null }));

import AppHeader from '@/components/AppHeader';
import { HeaderNav, TabBar } from '@/components/AppNav';

const me: User = { id: 'me', email: 'me@example.com', username: 'mikita' };

// The unread count's reads (`useUnreadNotifications`): `unread` is what they answer.
const fetchMock = vi.fn();
let unread = 0;

beforeEach(() => {
  cleanup();
  state.user = me;
  state.loading = false;
  state.pathname = '/';
  unread = 0;
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => ({
    json: async () => ({ success: true, data: [], unreadCount: unread }),
  }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const tabBar = () => document.querySelector<HTMLElement>('[data-tab-bar]');
/** The header's own links (the nav inside <header>). */
const headerNav = () =>
  within(screen.getByRole('banner')).queryByRole('navigation', { name: 'Main' });
const current = (root: HTMLElement) =>
  [...root.querySelectorAll('[aria-current="page"]')].map((el) => el.textContent);

describe('TabBar', () => {
  it('has Home, Reserved, Activity and Me, each a link with an icon and a label', () => {
    render(<TabBar username="mikita" />);
    const bar = screen.getByRole('navigation', { name: 'Main' });
    expect(bar).toHaveAttribute('data-tab-bar', 'shown');

    const links = within(bar).getAllByRole('link');
    expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Home', '/'],
      ['Reserved', '/booked'],
      ['Activity', '/notifications'],
      ['Me', '/users/mikita'],
    ]);
    for (const link of links) expect(link.querySelector('svg')).not.toBeNull();
  });

  it.each([
    ['/', 'Home'],
    ['/wishlists/mine', 'Home'],
    ['/wishlists/shared', 'Home'],
    ['/items', 'Home'],
    ['/booked', 'Reserved'],
    ['/notifications', 'Activity'],
    ['/users/mikita', 'Me'],
  ])('marks the page it is on, %s, as %s (and only that one)', (path, label) => {
    state.pathname = path;
    render(<TabBar username="mikita" />);
    expect(current(screen.getByRole('navigation'))).toEqual([label]);
  });

  it.each(['/wishlists/e2e-birthday', '/users/alice', '/settings'])(
    'marks none of them on %s',
    (path) => {
      state.pathname = path;
      render(<TabBar username="mikita" />);
      expect(current(screen.getByRole('navigation'))).toEqual([]);
    }
  );

  it('sends Me to Settings while the account has no username', () => {
    render(<TabBar username={null} />);
    expect(screen.getByRole('link', { name: 'Me' })).toHaveAttribute('href', '/settings');
  });

  // WIS-302: Activity carries the unread count, the one unread signal.
  it('badges Activity’s icon with the unread count, and says it in the tab’s name', () => {
    render(<TabBar username="mikita" unread={3} />);
    const activity = screen.getByRole('link', { name: 'Activity, 3 unread' });
    const badge = activity.querySelector('[data-badge]');
    expect(badge).toHaveTextContent(/^3$/);
    expect(badge).toHaveAttribute('aria-hidden', 'true');
    // On the icon, in the same box: the label stays under it.
    expect(badge?.parentElement?.querySelector('svg')).not.toBeNull();
    // Only Activity has one.
    expect(document.querySelectorAll('[data-badge]')).toHaveLength(1);
  });

  it('shows no badge on Activity while nothing is unread', () => {
    render(<TabBar username="mikita" unread={0} />);
    const activity = screen.getByRole('link', { name: 'Activity' });
    expect(activity).not.toHaveAttribute('aria-label');
    expect(activity).toHaveTextContent(/^Activity$/);
    expect(document.querySelector('[data-badge]')).toBeNull();
  });

  it('caps the badge at 9+, while the name keeps the full count', () => {
    render(<TabBar username="mikita" unread={12} />);
    const activity = screen.getByRole('link', { name: 'Activity, 12 unread' });
    expect(activity.querySelector('[data-badge]')).toHaveTextContent(/^9\+$/);
  });

  it('while the session loads, is a placeholder with no links, hidden from assistive tech', () => {
    render(<TabBar pending />);
    const bar = tabBar()!;
    expect(bar).toHaveAttribute('data-tab-bar', 'pending');
    expect(bar).toHaveAttribute('aria-hidden', 'true');
    expect(bar.querySelector('a')).toBeNull();
    expect(screen.queryByRole('navigation')).toBeNull();
  });
});

describe('HeaderNav — Activity’s count', () => {
  it('puts the unread count beside the Activity link, and says it in the link’s name', () => {
    render(<HeaderNav username="mikita" unread={3} />);
    const activity = screen.getByRole('link', { name: 'Activity, 3 unread' });
    expect(activity.querySelector('[data-badge]')).toHaveTextContent(/^3$/);
    expect(activity).toHaveTextContent(/^Activity3$/);
    expect(document.querySelectorAll('[data-badge]')).toHaveLength(1);
  });

  it('shows no badge while nothing is unread', () => {
    render(<HeaderNav username="mikita" />);
    expect(screen.getByRole('link', { name: 'Activity' })).toHaveTextContent(/^Activity$/);
    expect(document.querySelector('[data-badge]')).toBeNull();
  });

  it('caps the badge at 9+, while the name keeps the full count', () => {
    render(<HeaderNav username="mikita" unread={30} />);
    const activity = screen.getByRole('link', { name: 'Activity, 30 unread' });
    expect(activity.querySelector('[data-badge]')).toHaveTextContent(/^9\+$/);
  });
});

describe('AppHeader — navigation', () => {
  it('links Home · Reserved · Activity in the header, with Me left to the avatar', () => {
    state.pathname = '/booked';
    render(<AppHeader />);
    const nav = headerNav()!;
    expect(
      within(nav)
        .getAllByRole('link')
        .map((a) => [a.textContent, a.getAttribute('href')])
    ).toEqual([
      ['Home', '/'],
      ['Reserved', '/booked'],
      ['Activity', '/notifications'],
    ]);
    expect(current(nav)).toEqual(['Reserved']);
  });

  it('puts the tab bar beside the header, not inside it', () => {
    render(<AppHeader />);
    expect(tabBar()).toHaveAttribute('data-tab-bar', 'shown');
    expect(screen.getByRole('banner')).not.toContainElement(tabBar());
  });

  it('shows no tab bar and no links to a signed-out visitor', () => {
    state.user = null;
    render(<AppHeader />);
    expect(tabBar()).toBeNull();
    expect(headerNav()).toBeNull();
    expect(screen.queryByRole('link', { name: 'Home' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New list' })).toBeNull();
  });

  // WIS-302: New list lives on Home and My wishlists, not in the header.
  it('has no New list in the header for someone signed in', () => {
    render(<AppHeader />);
    expect(screen.queryByRole('button', { name: 'New list' })).toBeNull();
  });

  // WIS-209: the signed-in row's shape is held while the session loads, so
  // nothing in it moves when the session lands. Placeholders are hidden from
  // assistive tech; CSS shows them only under the session hint.
  it('while the session loads, holds the places of the links and the tab bar, and nothing else', () => {
    state.user = null;
    state.loading = true;
    render(<AppHeader />);

    expect(tabBar()).toHaveAttribute('data-tab-bar', 'pending');
    expect(headerNav()).toHaveClass('hidden', 'sm:session-hint:flex');
    // No New list and no bell to hold a place for (WIS-302): the account
    // button's placeholder is AuthButton's own, not rendered here.
    // Only the discreet-mode switch's (WIS-46).
    const places = screen.getByRole('banner').querySelectorAll('.skeleton');
    expect(places).toHaveLength(1);
    expect(places[0]).toHaveClass('hidden', 'session-hint:block');
  });

  it('keeps the navigation up while a known session is updated', () => {
    state.loading = true;
    render(<AppHeader />);
    expect(tabBar()).toHaveAttribute('data-tab-bar', 'shown');
    expect(headerNav()).toHaveClass('flex');
  });
});

// WIS-302: the bell duplicated Activity, so it's gone, and its count moved to
// Activity's badge, read once for the tab bar and the header link alike.
describe('AppHeader — Activity’s unread count', () => {
  const activityLinks = () => screen.queryAllByRole('link', { name: /^Activity/ });

  it('has no bell', async () => {
    unread = 2;
    render(<AppHeader />);
    await screen.findAllByRole('link', { name: 'Activity, 2 unread' });
    expect(screen.queryByRole('link', { name: /notification/i })).toBeNull();
    expect(screen.queryByTitle('Notifications')).toBeNull();
    // The banner's links: the logo and Home · Reserved · Activity, nothing else.
    expect(
      within(screen.getByRole('banner'))
        .getAllByRole('link')
        .map((a) => a.getAttribute('href'))
    ).toEqual(['/', '/', '/booked', '/notifications']);
  });

  it('shows the count on both the tab and the header link, from one read', async () => {
    unread = 3;
    render(<AppHeader />);
    const links = await screen.findAllByRole('link', { name: 'Activity, 3 unread' });
    expect(links).toHaveLength(2);
    expect(headerNav()).toContainElement(links[0]);
    expect(tabBar()).toContainElement(links[1]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shows no count at 0', async () => {
    render(<AppHeader />);
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(activityLinks().map((a) => a.textContent)).toEqual(['Activity', 'Activity']);
    expect(document.querySelector('[data-badge]')).toBeNull();
  });

  it.each(['invites-changed', 'notifications-changed', 'focus'])(
    'follows the count on %s, and the badge goes at 0',
    async (event) => {
      unread = 1;
      render(<AppHeader />);
      await screen.findAllByRole('link', { name: 'Activity, 1 unread' });

      unread = 4;
      await act(async () => {
        window.dispatchEvent(new Event(event));
      });
      expect(screen.getAllByRole('link', { name: 'Activity, 4 unread' })).toHaveLength(2);

      // Activity marked everything read.
      unread = 0;
      await act(async () => {
        window.dispatchEvent(new Event(event));
      });
      expect(activityLinks().map((a) => a.getAttribute('aria-label'))).toEqual([null, null]);
      expect(document.querySelector('[data-badge]')).toBeNull();
    }
  );

  it('reads nothing and shows no count to a signed-out visitor', async () => {
    state.user = null;
    render(<AppHeader />);
    await act(async () => {});
    expect(fetchMock).not.toHaveBeenCalled();
    expect(activityLinks()).toEqual([]);
  });

  it('shows no count on the placeholders while the session loads', () => {
    state.user = null;
    state.loading = true;
    render(<AppHeader />);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.querySelector('[data-badge]')).toBeNull();
  });
});
