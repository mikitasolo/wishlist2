// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import type { Occasion, OccasionKind } from '@/lib/utils/occasion';

const { push, showToast } = vi.hoisted(() => ({ push: vi.fn(), showToast: vi.fn() }));

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { user: { id: 'me', username: 'me' } },
    status: 'authenticated',
  }),
  signIn: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useParams: () => ({ username: 'friend' }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// The header, the dialogs, the share button and the currency prompt have their
// own fetches and tests; this file is about the order of the list cards.
vi.mock('@/components/AppHeader', () => ({ default: () => null }));
vi.mock('@/components/CurrencyPrompt', () => ({ default: () => null }));
vi.mock('@/components/AuthButton', () => ({ default: () => null }));
vi.mock('@/components/GlobalSearch', () => ({ default: () => null }));
vi.mock('@/components/CreateWishlistModal', () => ({ default: () => null }));
vi.mock('@/components/FollowListModal', () => ({ default: () => null }));
vi.mock('@/components/ShareButton', () => ({ default: () => null }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));

import Home from '@/app/page';
import MyWishlistsPage from '@/app/wishlists/mine/page';
import SharedWishlistsPage from '@/app/wishlists/shared/page';
import UserProfile from '@/app/users/[username]/page';

// Today is Oct 2, 2026. Yearly occasions are stored on the placeholder year.
const yearly = (date: string, kind: OccasionKind = 'birthday'): Occasion => ({
  kind,
  date,
  recurrence: 'yearly',
});
const once = (date: string): Occasion => ({ kind: 'wedding', date, recurrence: null });

let nextId = 0;
function list(name: string, occasion: Occasion | null, fields: Record<string, unknown> = {}) {
  nextId += 1;
  return {
    _id: `w${nextId}`,
    slug: name.toLowerCase().replace(/\W+/g, '-'),
    name,
    visibility: 'everyone',
    itemCount: 1,
    owners: ['me'],
    featured: false,
    occasion,
    ...fields,
  };
}

// Each in the API's order: newest first.
const owned = [
  list('Housewarming', null),
  list('Wedding', once('2026-06-12')), // passed
  list('Christmas', yearly('2000-12-25', 'holiday')), // in 84 days
  list('Old notes', null, { archived: true }),
  list('Birthday', yearly('2000-10-14')), // in 12 days
  list('Last year', yearly('2000-10-05'), { archived: true }), // in 3 days
  list('Anniversary', once('2026-11-07')), // in 36 days
  list('Books', null),
];
const christmas = owned[2];
const shared = [
  list('Friend’s books', null, { userRole: 'member', ownerUsername: 'friend' }),
  list('Friend’s birthday', yearly('2000-10-03'), { userRole: 'member', ownerUsername: 'friend' }),
];

const BY_OCCASION = ['Birthday', 'Anniversary', 'Christmas', 'Housewarming', 'Wedding', 'Books'];
const ARCHIVED_BY_OCCASION = ['Last year', 'Old notes'];
const SHARED_AS_SENT = ['Friend’s books', 'Friend’s birthday'];

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
    if (url === '/api/users/me/reservations/count') {
      return json({ success: true, data: { count: 0 } });
    }
    if (url === '/api/users/me') {
      return json({ success: true, data: { _id: 'me', followerCount: 0, followingCount: 0 } });
    }
    if (url === '/api/users/by-username/friend') {
      return json({
        success: true,
        data: { _id: 'friend-id', username: 'friend', isSelf: false, followerCount: 0 },
      });
    }
    if (url === '/api/users/friend-id/wishlists') return json({ success: true, data: shared });
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** The names of the cards in a part of the page, top to bottom. */
const cardNames = (container: HTMLElement) =>
  within(container)
    .getAllByRole('heading', { level: 3 })
    .map((h) => h.textContent);

/** The section of the dashboard under a heading. */
const section = (name: string) =>
  screen.getByRole('heading', { level: 2, name }).closest('section') as HTMLElement;

describe('wishlists/mine — order', () => {
  it('puts the lists with an occasion coming up first, nearest first, and the rest as before', async () => {
    render(<MyWishlistsPage />);
    await screen.findByText('Birthday · in 12 days');

    // The active grid, then the archived section, sorted the same way.
    expect(cardNames(document.body)).toEqual([...BY_OCCASION, ...ARCHIVED_BY_OCCASION]);
    expect(cardNames(section('Archived'))).toEqual(ARCHIVED_BY_OCCASION);
  });

  it('sorts again when the date moves on, e.g. the tab shown again the next day', async () => {
    render(<MyWishlistsPage />);
    await screen.findByText('Birthday · in 12 days');

    // Oct 15: the birthday was yesterday, so it's next on Oct 14, 2027.
    vi.setSystemTime(new Date(2026, 9, 15, 12));
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await screen.findByText('Birthday · in 364 days');
    expect(cardNames(document.body).slice(0, BY_OCCASION.length)).toEqual([
      'Anniversary',
      'Christmas',
      'Birthday',
      'Housewarming',
      'Wedding',
      'Books',
    ]);
  });
});

describe('dashboard — order', () => {
  it('sorts your own lists by the nearest occasion, and leaves the shared lists as they are', async () => {
    render(<Home />);
    await screen.findByText('Birthday · in 12 days');

    expect(cardNames(section('Your wishlists'))).toEqual(BY_OCCASION);
    expect(cardNames(section('Archived'))).toEqual(ARCHIVED_BY_OCCASION);
    expect(cardNames(section('Shared with you'))).toEqual(SHARED_AS_SENT);
  });

  it('keeps that order when a list is pinned as Featured, and shows its occasion on the highlight', async () => {
    const user = userEvent.setup();
    render(<Home />);
    await screen.findByText('Birthday · in 12 days');
    // The automatic pick (most items, then newest) has no occasion.
    const highlight = () =>
      screen.getAllByRole('heading', { level: 2 })[0].closest('a') as HTMLElement;
    expect(highlight()).toHaveTextContent('Housewarming');
    expect(highlight().querySelector('time')).toBeNull();

    await user.click(screen.getByRole('combobox', { name: 'Featured wishlist' }));
    await user.click(screen.getByRole('option', { name: 'Christmas' }));

    await waitFor(() => expect(highlight()).toHaveTextContent('Christmas'));
    expect(within(highlight()).getByText('Holiday · in 84 days')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/wishlists/${christmas._id}`,
      expect.objectContaining({ method: 'PATCH' })
    );
    const card = within(section('Your wishlists'))
      .getByRole('heading', { level: 3, name: 'Christmas' })
      .closest('a') as HTMLElement;
    expect(within(card).getByText('Featured')).toBeInTheDocument();
    expect(cardNames(section('Your wishlists'))).toEqual(BY_OCCASION);
  });
});

describe("other people's lists — order", () => {
  it('keeps the API’s order on wishlists/shared, occasion or not', async () => {
    render(<SharedWishlistsPage />);
    await screen.findByText('Birthday · tomorrow');
    expect(cardNames(document.body)).toEqual(SHARED_AS_SENT);
  });

  it('keeps the API’s order on a profile, occasion or not', async () => {
    render(<UserProfile />);
    await screen.findByText('Birthday · tomorrow');
    expect(cardNames(document.body)).toEqual(SHARED_AS_SENT);
  });
});
