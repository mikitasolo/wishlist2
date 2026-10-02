// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import type { Occasion } from '@/lib/utils/occasion';

const { push, showToast } = vi.hoisted(() => ({ push: vi.fn(), showToast: vi.fn() }));

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { user: { id: 'me', username: 'me' } },
    status: 'authenticated',
  }),
  signIn: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// The header, the create dialog and the follow lists have their own fetches and
// tests; this file is about the order of the list cards.
vi.mock('@/components/AppHeader', () => ({ default: () => null }));
vi.mock('@/components/AuthButton', () => ({ default: () => null }));
vi.mock('@/components/GlobalSearch', () => ({ default: () => null }));
vi.mock('@/components/CreateWishlistModal', () => ({ default: () => null }));
vi.mock('@/components/FollowListModal', () => ({ default: () => null }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));

import Home from '@/app/page';
import MyWishlistsPage from '@/app/wishlists/mine/page';
import SharedWishlistsPage from '@/app/wishlists/shared/page';

// Today is Oct 2, 2026. Yearly occasions are stored on the placeholder year.
const yearly = (date: string): Occasion => ({ kind: 'birthday', date, recurrence: 'yearly' });
const once = (date: string): Occasion => ({ kind: 'wedding', date, recurrence: null });

let nextId = 0;
function list(name: string, occasion: Occasion | null, fields: Record<string, unknown> = {}) {
  nextId += 1;
  return {
    _id: `w${nextId}`,
    slug: name.toLowerCase().replace(/\s+/g, '-'),
    name,
    visibility: 'everyone',
    itemCount: 1,
    owners: ['me'],
    featured: false,
    occasion,
    ...fields,
  };
}

// In the API's order: newest first.
const owned = [
  list('Housewarming', null),
  list('Wedding', once('2026-06-12')), // passed
  list('Christmas', yearly('2000-12-25')), // in 84 days
  list('Old notes', null, { archived: true }),
  list('Birthday', yearly('2000-10-14')), // in 12 days
  list('Last year', yearly('2000-10-05'), { archived: true }), // in 3 days, but archived
  list('Anniversary', once('2026-11-07')), // in 36 days
  list('Books', null),
];
const shared = [
  list('Friend’s books', null, { userRole: 'member', ownerUsername: 'friend' }),
  list('Friend’s birthday', yearly('2000-10-03'), { userRole: 'member', ownerUsername: 'friend' }),
];

const BY_OCCASION = ['Birthday', 'Anniversary', 'Christmas', 'Housewarming', 'Wedding', 'Books'];

function json(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 2, 12)); // local noon, Oct 2
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') return json({ success: true });
    if (url === '/api/wishlists') return json({ success: true, data: { owned, member: shared } });
    if (url === '/api/users/me/reservations') return json({ success: true, data: [] });
    if (url === '/api/users/me') {
      return json({ success: true, data: { _id: 'me', followerCount: 0, followingCount: 0 } });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** The names of the cards in a part of the page, top to bottom. */
const cardNames = (within_: HTMLElement) =>
  within(within_)
    .getAllByRole('heading', { level: 3 })
    .map((h) => h.textContent);

/** The section of the dashboard under a heading. */
const section = (name: string) =>
  screen.getByRole('heading', { level: 2, name }).closest('section') as HTMLElement;

describe('wishlists/mine — order', () => {
  it('puts the lists with an occasion coming up first, nearest first, and the rest as before', async () => {
    render(<MyWishlistsPage />);
    await screen.findByText('Birthday · in 12 days');

    // The active grid, then the archived section, which keeps the API's order.
    expect(cardNames(document.body)).toEqual([...BY_OCCASION, 'Old notes', 'Last year']);
    expect(cardNames(section('Archived'))).toEqual(['Old notes', 'Last year']);
  });
});

describe('dashboard — order', () => {
  it('sorts "Your wishlists" by the nearest occasion, and leaves the shared and archived lists as they are', async () => {
    render(<Home />);
    await screen.findByText('Birthday · in 12 days');

    expect(cardNames(section('Your wishlists'))).toEqual(BY_OCCASION);
    expect(cardNames(section('Shared with you'))).toEqual(['Friend’s books', 'Friend’s birthday']);
    expect(cardNames(section('Archived'))).toEqual(['Old notes', 'Last year']);
  });

  it('keeps that order when a list is pinned as Featured', async () => {
    const user = userEvent.setup();
    render(<Home />);
    await screen.findByText('Birthday · in 12 days');

    await user.click(screen.getByRole('button', { name: 'Featured wishlist' }));
    await user.click(screen.getByRole('option', { name: 'Books' }));

    const books = within(section('Your wishlists'))
      .getByRole('heading', { level: 3, name: 'Books' })
      .closest('a') as HTMLElement;
    await waitFor(() => expect(within(books).getByText('Featured')).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/wishlists/${owned[7]._id}`,
      expect.objectContaining({ method: 'PATCH' })
    );
    expect(cardNames(section('Your wishlists'))).toEqual(BY_OCCASION);
  });
});

describe('wishlists/shared — order', () => {
  it('keeps the API’s order, occasion or not', async () => {
    render(<SharedWishlistsPage />);
    await screen.findByText('Birthday · tomorrow');
    expect(cardNames(document.body)).toEqual(['Friend’s books', 'Friend’s birthday']);
  });
});
