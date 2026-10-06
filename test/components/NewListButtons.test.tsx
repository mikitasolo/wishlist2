// @vitest-environment jsdom
// New list (WIS-242): the header's "+" says what it makes, and the dashboard
// and My wishlists offer it in place: the dashboard in its greeting row
// (WIS-252), My wishlists beside its "Your wishlists" heading and in its empty
// state. Each opens the create dialog on the page.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';

const { showToast, session } = vi.hoisted(() => ({
  showToast: vi.fn(),
  session: {
    current: {
      data: { user: { id: 'me', username: 'me' } },
      status: 'authenticated',
    } as { data: { user: { id: string; username: string } } | null; status: string },
  },
}));

vi.mock('next-auth/react', () => ({ useSession: () => session.current, signIn: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/',
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
// The header's other parts have their own fetches and tests.
vi.mock('@/components/GlobalSearch', () => ({ default: () => null }));
vi.mock('@/components/AuthButton', () => ({ default: () => null }));
vi.mock('@/lib/hooks/useUnreadNotifications', () => ({ useUnreadNotifications: () => 0 }));
vi.mock('@/components/NeedsYou', () => ({ default: () => null }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));
// The create dialog has its own tests: here, only whether it's open.
vi.mock('@/components/CreateWishlistModal', () => ({
  default: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div role="dialog" aria-label="Create new wishlist" /> : null,
}));

import AppHeader from '@/components/AppHeader';
import Home from '@/components/Dashboard';
import MyWishlistsPage from '@/app/wishlists/mine/page';
import { atWidth } from './viewport';

function list(id: string, fields: Record<string, unknown> = {}) {
  return {
    _id: id,
    slug: id,
    name: id,
    visibility: 'everyone',
    owners: ['me'],
    featured: false,
    occasion: null,
    itemCount: 1,
    ...fields,
  };
}

let owned: unknown[];

const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

beforeEach(() => {
  // Desktop width: the lists are cards (a phone gets rows, `WishlistList.test.tsx`).
  atWidth(1280);
  session.current = { data: { user: { id: 'me', username: 'me' } }, status: 'authenticated' };
  owned = [list('birthday')];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/wishlists') return json({ success: true, data: { owned, member: [] } });
      if (url === '/api/users/me/birthdays') return json({ success: true, data: [] });
      throw new Error(`unexpected fetch ${url}`);
    })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const createDialog = () => screen.queryByRole('dialog', { name: 'Create new wishlist' });

// WIS-302: the header has no New list at any width, signed in or out: Home's
// greeting row and My wishlists offer it in place.
describe('the header', () => {
  it.each([390, 640, 768, 1280])('has no New list at %ipx', (width) => {
    atWidth(width);
    render(<AppHeader />);
    // Only the discreet-mode switch (WIS-46) is a button in it.
    expect(
      within(screen.getByRole('banner'))
        .queryAllByRole('button')
        .map((b) => b.getAttribute('aria-label'))
    ).toEqual(['Discreet mode']);
    expect(screen.queryByRole('button', { name: /New (list|wishlist)/ })).toBeNull();
    expect(createDialog()).toBeNull();
  });

  it('has none for a signed-out visitor, nor while the session loads', () => {
    session.current = { data: null, status: 'unauthenticated' };
    const { unmount } = render(<AppHeader />);
    expect(screen.queryByRole('button', { name: 'New list' })).toBeNull();
    unmount();

    session.current = { data: null, status: 'loading' };
    render(<AppHeader />);
    expect(screen.getByRole('banner')).not.toHaveTextContent('New list');
  });
});

/**
 * The heading's row: the heading and what sits beside it (on the dashboard the
 * heading shares a group with All items, so the row is the group's parent).
 */
const headingRow = (heading: HTMLElement) => {
  let row = heading.parentElement as HTMLElement;
  while (!row.querySelector('button') && row.parentElement) row = row.parentElement;
  return row;
};

describe('the dashboard’s New list', () => {
  it('sits beside the greeting, as its primary button, and opens the create dialog in place', async () => {
    const user = userEvent.setup();
    render(<Home />);

    await screen.findByRole('heading', { level: 2, name: 'Your wishlists' });
    const greeting = screen.getByRole('heading', { level: 1 });
    const button = within(headingRow(greeting)).getByRole('button', { name: 'New list' });

    await user.click(button);
    expect(createDialog()).toBeInTheDocument();
  });
});

describe('My wishlists’ New list', () => {
  it('sits beside the Your wishlists heading and opens the create dialog in place', async () => {
    const user = userEvent.setup();
    render(<MyWishlistsPage />);
    await screen.findByRole('link', { name: /birthday/ });

    const heading = screen.getByRole('heading', { level: 1, name: 'Your wishlists' });
    const button = within(headingRow(heading)).getByRole('button', { name: 'New list' });

    await user.click(button);
    expect(createDialog()).toBeInTheDocument();
  });

  // regression: the empty state said "Create a wishlist from the header", with
  // no button of its own.
  it('regression: offers New list in the empty state too', async () => {
    owned = [];
    const user = userEvent.setup();
    render(<MyWishlistsPage />);

    const empty = (await screen.findByRole('heading', { name: 'No wishlists yet' }))
      .parentElement as HTMLElement;
    expect(empty).not.toHaveTextContent(/from the header/);

    await user.click(within(empty).getByRole('button', { name: 'New list' }));
    expect(createDialog()).toBeInTheDocument();
  });
});
