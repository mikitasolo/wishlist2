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
  usePathname: () => '/users/friend',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// The header, the dialogs, the share button and Needs you have their own
// fetches and tests; this file is about the order of the list cards.
vi.mock('@/components/AppHeader', () => ({ default: () => null }));
vi.mock('@/components/NeedsYou', () => ({ default: () => null }));
vi.mock('@/components/AuthButton', () => ({ default: () => null }));
vi.mock('@/components/GlobalSearch', () => ({ default: () => null }));
vi.mock('@/components/CreateWishlistModal', () => ({ default: () => null }));
vi.mock('@/components/FollowListModal', () => ({ default: () => null }));
vi.mock('@/components/ShareButton', () => ({ default: () => null }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));

import Home from '@/components/Dashboard';
import MyWishlistsPage from '@/app/wishlists/mine/page';
import SharedWishlistsPage from '@/app/wishlists/shared/page';
import UserProfile from '@/app/users/[username]/page';
import { atWidth } from './viewport';

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
// As /api/wishlists sends them: each with the items you've reserved on it.
const shared = [
  list('Friend’s wedding', once('2026-11-01'), {
    userRole: 'member',
    ownerUsername: 'friend',
    reservedByYou: 0,
  }), // in 30 days
  list('Friend’s books', null, { userRole: 'member', ownerUsername: 'friend', reservedByYou: 1 }),
  list('Friend’s birthday', yearly('2000-10-03'), {
    userRole: 'member',
    ownerUsername: 'friend',
    reservedByYou: 2,
  }), // tomorrow
];

const BY_OCCASION = ['Birthday', 'Anniversary', 'Christmas', 'Housewarming', 'Wedding', 'Books'];
const ARCHIVED_BY_OCCASION = ['Last year', 'Old notes'];
const SHARED_BY_OCCASION = ['Friend’s birthday', 'Friend’s wedding', 'Friend’s books'];

function json(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  // Desktop width: the lists are cards (a phone gets rows, `WishlistList.test.tsx`).
  atWidth(1280);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 2, 12)); // local noon, Oct 2
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') return json({ success: true });
    if (url === '/api/wishlists') return json({ success: true, data: { owned, member: shared } });
    if (url === '/api/users/by-username/friend') {
      return json({
        success: true,
        data: { _id: 'friend-id', username: 'friend', isSelf: false, followerCount: 0 },
      });
    }
    if (url === '/api/users/friend-id/wishlists') return json({ success: true, data: shared });
    if (url === '/api/users/me/birthdays') return json({ success: true, data: [] });
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

/** Opens the archived lists, folded away at the end of the page (WIS-254). */
const openArchived = () =>
  userEvent.setup().click(screen.getByRole('button', { name: 'Archived (2)' }));

describe('wishlists/mine — order', () => {
  it('puts the lists with an occasion coming up first, nearest first, and the rest as before', async () => {
    render(<MyWishlistsPage />);
    await screen.findByText('Birthday · in 12 days');
    await openArchived();

    // The active grid, then the archived section, sorted the same way.
    expect(cardNames(document.body)).toEqual([...BY_OCCASION, ...ARCHIVED_BY_OCCASION]);
    expect(cardNames(section('Archived (2)'))).toEqual(ARCHIVED_BY_OCCASION);
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
  it('sorts your own lists and the ones shared with you by the nearest occasion', async () => {
    render(<Home />);
    await screen.findByText('Birthday · in 12 days');
    await openArchived();

    expect(cardNames(section('Your wishlists'))).toEqual(BY_OCCASION);
    expect(cardNames(section('Archived (2)'))).toEqual(ARCHIVED_BY_OCCASION);
    expect(cardNames(section('Shared with you'))).toEqual(SHARED_BY_OCCASION);
  });

  it('puts your pinned list above the nearest occasions, and pinning another moves that one up', async () => {
    const user = userEvent.setup();
    render(<Home />);
    await screen.findByText('Birthday · in 12 days');

    const card = (name: string) =>
      within(section('Your wishlists')).getByRole('heading', { level: 3, name }).closest('a')!
        .parentElement as HTMLElement;
    await user.click(
      within(card('Christmas')).getByRole('button', { name: 'Pin to top', pressed: false })
    );

    await waitFor(() => expect(cardNames(section('Your wishlists'))[0]).toBe('Christmas'));
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/wishlists/${christmas._id}`,
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ featured: true }) })
    );
    // The rest keep their order, and its pin is pressed.
    expect(cardNames(section('Your wishlists'))).toEqual([
      'Christmas',
      ...BY_OCCASION.filter((name) => name !== 'Christmas'),
    ]);
    expect(
      within(card('Christmas')).getByRole('button', { name: 'Pin to top', pressed: true })
    ).toBeInTheDocument();
  });
});

describe('dashboard — order on a phone', () => {
  it('lists the same order as rows (WIS-254)', async () => {
    atWidth(390);
    render(<Home />);
    await screen.findByText('Birthday · in 12 days');

    /** The names of a section's rows, top to bottom: each row's first line (not All items). */
    const rowNames = (name: string) =>
      within(section(name))
        .getAllByRole('link')
        .filter((a) => a.getAttribute('href')?.startsWith('/wishlists/'))
        .map((a) => a.querySelector('.text-body')?.textContent);
    expect(rowNames('Your wishlists')).toEqual(BY_OCCASION);
    expect(rowNames('Shared with you')).toEqual(SHARED_BY_OCCASION);
    // No cards anywhere: the lists' only headings are the sections'.
    expect(screen.queryAllByRole('heading', { level: 3 })).toHaveLength(0);
  });
});

describe("other people's lists — order", () => {
  it('sorts wishlists/shared by the nearest occasion, by your local date', async () => {
    render(<SharedWishlistsPage />);
    await screen.findByText('Birthday · tomorrow');
    expect(cardNames(document.body)).toEqual(SHARED_BY_OCCASION);
  });

  it('sorts wishlists/shared again when the date moves on', async () => {
    render(<SharedWishlistsPage />);
    await screen.findByText('Birthday · tomorrow');

    // Oct 5: the birthday was yesterday, so it's next on Oct 3, 2027.
    vi.setSystemTime(new Date(2026, 9, 5, 12));
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await screen.findByText('Birthday · in 363 days');
    expect(cardNames(document.body)).toEqual([
      'Friend’s wedding',
      'Friend’s birthday',
      'Friend’s books',
    ]);
  });

  // WIS-272: a profile sorts by the nearest occasion too, as the dashboard does.
  it('sorts a profile by the nearest occasion, by your local date', async () => {
    render(<UserProfile />);
    await screen.findByText('Birthday · tomorrow');
    expect(cardNames(document.body)).toEqual(SHARED_BY_OCCASION);
  });
});

/** The card of the list with this name. */
const card = (container: HTMLElement, name: string) =>
  within(container).getByRole('heading', { level: 3, name }).closest('a') as HTMLElement;

describe('Shared with you — badges', () => {
  it('drops the Member badge on wishlists/shared, and shows what you have reserved', async () => {
    render(<SharedWishlistsPage />);
    await screen.findByText('Birthday · tomorrow');

    // Every list here is one you're a member of: the page's title says so.
    expect(screen.queryByText(/^member$/i)).toBeNull();
    expect(
      within(card(document.body, 'Friend’s birthday')).getByText('2 reserved by you')
    ).toBeInTheDocument();
    expect(
      within(card(document.body, 'Friend’s books')).getByText('1 reserved by you')
    ).toBeInTheDocument();
    // None where you hold none.
    expect(card(document.body, 'Friend’s wedding')).not.toHaveTextContent('reserved by you');
  });

  it("drops it in the dashboard's Shared with you too, with the same chips", async () => {
    render(<Home />);
    await screen.findByText('Birthday · in 12 days');

    const shared = section('Shared with you');
    expect(within(shared).queryByText(/^member$/i)).toBeNull();
    expect(
      within(card(shared, 'Friend’s birthday')).getByText('2 reserved by you')
    ).toBeInTheDocument();
    expect(card(shared, 'Friend’s wedding')).not.toHaveTextContent('reserved by you');
    // Your own lists carry no count, so no chip.
    expect(section('Your wishlists')).not.toHaveTextContent('reserved by you');
  });

  it('shows the same chips on the rows of a phone, with no Member badge (WIS-254)', async () => {
    atWidth(390);
    render(<Home />);
    await screen.findByText('Birthday · in 12 days');

    const shared = section('Shared with you');
    const row = (name: string) => within(shared).getByRole('link', { name: new RegExp(name) });
    expect(within(row('Friend’s birthday')).getByText('2 reserved by you')).toBeInTheDocument();
    expect(within(row('Friend’s books')).getByText('1 reserved by you')).toBeInTheDocument();
    expect(row('Friend’s wedding')).not.toHaveTextContent('reserved by you');
    expect(within(shared).queryByText(/^member$/i)).toBeNull();
    expect(section('Your wishlists')).not.toHaveTextContent('reserved by you');
  });

  it('keeps the role on a profile, which says nothing about it', async () => {
    render(<UserProfile />);
    await screen.findByText('Birthday · tomorrow');
    expect(screen.getAllByText('member')).toHaveLength(shared.length);
  });
});
