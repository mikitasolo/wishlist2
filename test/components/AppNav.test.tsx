// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
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
vi.mock('@/components/NotificationBell', () => ({ default: () => null }));

import AppHeader from '@/components/AppHeader';
import { TabBar } from '@/components/AppNav';

const me: User = { id: 'me', email: 'me@example.com', username: 'mikita' };

beforeEach(() => {
  cleanup();
  state.user = me;
  state.loading = false;
  state.pathname = '/';
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

  // The bell is the one unread signal (D3): Activity carries no count of its own.
  it('carries no count on Activity', () => {
    render(<TabBar username="mikita" />);
    expect(screen.getByRole('link', { name: 'Activity' })).toHaveTextContent(/^Activity$/);
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

  it('shows no tab bar and no links to a signed-out visitor, and no New list', () => {
    state.user = null;
    render(<AppHeader />);
    expect(tabBar()).toBeNull();
    expect(headerNav()).toBeNull();
    expect(screen.queryByRole('link', { name: 'Home' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New list' })).toBeNull();
  });

  it('keeps New list in the header for someone signed in', () => {
    render(<AppHeader />);
    expect(screen.getByRole('button', { name: 'New list' })).toBeInTheDocument();
  });

  // WIS-209: the signed-in row's shape is held while the session loads, so
  // nothing in it moves when the session lands. Placeholders are hidden from
  // assistive tech; CSS shows them only under the session hint.
  it('while the session loads, holds the places of the links, New list and the tab bar', () => {
    state.user = null;
    state.loading = true;
    render(<AppHeader />);

    expect(tabBar()).toHaveAttribute('data-tab-bar', 'pending');
    expect(headerNav()).toHaveClass('hidden', 'sm:session-hint:flex');
    const newList = screen.getByRole('banner').querySelector('[aria-hidden="true"] .skeleton');
    expect(newList).toHaveTextContent('New list');
    expect(screen.queryByRole('button', { name: 'New list' })).toBeNull();
  });

  it('keeps the navigation up while a known session is updated', () => {
    state.loading = true;
    render(<AppHeader />);
    expect(tabBar()).toHaveAttribute('data-tab-bar', 'shown');
    expect(screen.getByRole('button', { name: 'New list' })).toBeInTheDocument();
  });
});
