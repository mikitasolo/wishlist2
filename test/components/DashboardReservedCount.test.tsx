// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';

const { showToast, auth } = vi.hoisted(() => {
  // The session's status, which the dashboard reads its lists again on:
  // next-auth's `update()` (the currency prompt's) turns it to `loading` and back.
  let status = 'authenticated';
  const listeners = new Set<() => void>();
  return {
    showToast: vi.fn(),
    auth: {
      status: () => status,
      set(next: string) {
        status = next;
        listeners.forEach((listener) => listener());
      },
      subscribe(listener: () => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  };
});

vi.mock('next-auth/react', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    useSession: () => ({
      data: { user: { id: 'me', username: 'me' } },
      status: useSyncExternalStore(auth.subscribe, auth.status),
      update: vi.fn(),
    }),
    signIn: vi.fn(),
  };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// The header and the dialogs have their own fetches and tests; this file is
// about the dashboard's own reads: the lists, and the counts it shows.
vi.mock('@/components/AppHeader', () => ({ default: () => null }));
vi.mock('@/components/AuthButton', () => ({ default: () => null }));
vi.mock('@/components/GlobalSearch', () => ({ default: () => null }));
vi.mock('@/components/CreateWishlistModal', () => ({ default: () => null }));
vi.mock('@/components/CurrencyPrompt', () => ({ default: () => null }));
vi.mock('@/components/FollowListModal', () => ({ default: () => null }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));

import Home from '@/app/page';

const owned = [
  {
    _id: 'w1',
    slug: 'birthday',
    name: 'Birthday',
    visibility: 'everyone',
    itemCount: 2,
    owners: ['me'],
    featured: false,
    occasion: null,
  },
];

type Response = { ok: boolean; status: number; json: () => Promise<unknown> };

function json(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body };
}
const serverError = (error: string) => json({ success: false, error }, 500);

/** What each read is answered with: a response (possibly held), or a network failure. */
type Answer = () => Response | Promise<Response>;
let answers: { lists: Answer; count: Answer; me: Answer };
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  auth.set('authenticated');
  answers = {
    lists: () => json({ success: true, data: { owned, member: [] } }),
    count: () => json({ success: true, data: { count: 3 } }),
    me: () => json({ success: true, data: { _id: 'me', followerCount: 4, followingCount: 5 } }),
  };
  fetchMock = vi.fn(async (url: string) => {
    if (url === '/api/wishlists') return answers.lists();
    if (url === '/api/users/me/reservations/count') return answers.count();
    if (url === '/api/users/me') return answers.me();
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  // A failed read logs a line; that's expected here.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Holds a read until `release` answers it, or fails it as the network would. */
function held() {
  let answerWith!: { resolve: (response: Response) => void; reject: (error: Error) => void };
  const answer = new Promise<Response>((resolve, reject) => (answerWith = { resolve, reject }));
  return {
    answer: () => answer,
    release: (outcome: Response | Error) =>
      act(async () => {
        if (outcome instanceof Error) answerWith.reject(outcome);
        else answerWith.resolve(outcome);
      }),
  };
}

/** Let reads whose answers the page has taken finish landing. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

const reservedTile = () => screen.findByRole('link', { name: /Reserved by you/ });
const requested = (url: string) => fetchMock.mock.calls.filter(([u]) => u === url).length;
const followers = () => screen.getByRole('button', { name: /followers/ });
const following = () => screen.getByRole('button', { name: /following/ });

describe('dashboard — Reserved by you', () => {
  it('shows the count from the count read, and never reads the Booked page’s list', async () => {
    render(<Home />);
    const tile = await reservedTile();

    expect(await within(tile).findByText('3')).toBeInTheDocument();
    expect(tile).toHaveAttribute('href', '/booked');
    expect(requested('/api/users/me/reservations/count')).toBe(1);
    expect(requested('/api/users/me/reservations')).toBe(0);
  });

  // regression: the tile started at 0, and kept it when the count read failed
  // (WIS-213), so a gifter holding bookings read "Reserved by you: 0".
  it.each<[string, Response | Error]>([
    ['a 5xx', serverError('Failed to count reservations')],
    ['a network error', new TypeError('Failed to fetch')],
  ])(
    'regression: shows no number while the count is read, nor once it fails with %s',
    async (_label, failure) => {
      const count = held();
      answers.count = count.answer;
      render(<Home />);
      const tile = await reservedTile();

      expect(within(tile).queryByText(/\d/)).toBeNull();
      expect(within(tile).getByText('Loading')).toBeInTheDocument();

      await count.release(failure);
      await settle();

      expect(within(tile).queryByText(/\d/)).toBeNull();
      expect(within(tile).getByText('Couldn’t load')).toBeInTheDocument();
      expect(within(tile).getByText('–')).toBeInTheDocument();
      expect(showToast).not.toHaveBeenCalled();
    }
  );
});

describe('dashboard — followers and following', () => {
  it('shows the counts once read', async () => {
    render(<Home />);
    await reservedTile();
    await settle();

    expect(followers()).toHaveTextContent('4 followers');
    expect(following()).toHaveTextContent('5 following');
  });

  // regression: they started at 0 too, and kept it when the read failed.
  it('regression: shows no number while they’re read, nor once that fails', async () => {
    const me = held();
    answers.me = me.answer;
    render(<Home />);
    await reservedTile();

    expect(followers()).not.toHaveTextContent(/\d/);
    expect(following()).not.toHaveTextContent(/\d/);

    await me.release(serverError('Failed to fetch user'));
    await settle();
    expect(followers()).not.toHaveTextContent(/\d/);
    expect(followers()).toHaveTextContent('Couldn’t load');
    expect(following()).not.toHaveTextContent(/\d/);
    expect(showToast).not.toHaveBeenCalled();
  });
});

describe('dashboard — lists that couldn’t be loaded', () => {
  // regression: a failed read of the lists fell through to the empty state, so
  // a user with lists read "No wishlists yet" and "Let's create your first
  // wishlist", with a Create button that invited duplicates. A toast that went
  // away on its own was the only sign of the error.
  it.each([
    ['a 5xx', () => serverError('Failed to fetch wishlists')],
    [
      'a network error',
      (): Response => {
        throw new TypeError('Failed to fetch');
      },
    ],
  ])(
    'regression: says so in their place after %s, with Try again, which reads them afresh',
    async (_label, fail) => {
      answers.lists = fail;
      render(<Home />);

      await screen.findByRole('heading', { name: 'Couldn’t load your wishlists' });
      await settle();
      expect(screen.queryByText('No wishlists yet')).toBeNull();
      expect(screen.queryByText('Let’s create your first wishlist.')).toBeNull();
      expect(screen.queryByRole('button', { name: /Create wishlist/ })).toBeNull();
      // No tiles either: their counts would claim there's nothing.
      expect(screen.queryByRole('link', { name: /Reserved by you/ })).toBeNull();
      expect(showToast).not.toHaveBeenCalled();

      answers.lists = () => json({ success: true, data: { owned, member: [] } });
      const reads = requested('/api/wishlists');
      await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));

      expect(await screen.findByRole('heading', { name: 'Your wishlists' })).toBeInTheDocument();
      expect(screen.getAllByText('Birthday').length).toBeGreaterThan(0);
      expect(screen.getByText('1 list · 2 items in your lists')).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Couldn’t load your wishlists' })).toBeNull();
      expect(requested('/api/wishlists')).toBe(reads + 1);
      expect(showToast).not.toHaveBeenCalled();
    }
  );

  it('Try again reads a count that failed with them again too', async () => {
    answers.lists = () => serverError('Failed to fetch wishlists');
    answers.count = () => serverError('Failed to count reservations');
    render(<Home />);
    await screen.findByRole('heading', { name: 'Couldn’t load your wishlists' });
    await settle();

    answers.lists = () => json({ success: true, data: { owned, member: [] } });
    answers.count = () => json({ success: true, data: { count: 3 } });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));

    const tile = await reservedTile();
    expect(await within(tile).findByText('3')).toBeInTheDocument();
    expect(requested('/api/users/me/reservations/count')).toBe(2);
  });

  it('treats the first read after signing out and back in as a first load', async () => {
    render(<Home />);
    await screen.findByRole('heading', { name: 'Your wishlists' });

    answers.lists = () => serverError('Failed to fetch wishlists');
    act(() => auth.set('unauthenticated'));
    act(() => auth.set('authenticated'));

    expect(
      await screen.findByRole('heading', { name: 'Couldn’t load your wishlists' })
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Your wishlists' })).toBeNull();
    expect(showToast).not.toHaveBeenCalled();
  });

  it('keeps the lists on screen when a later read of them fails', async () => {
    render(<Home />);
    await screen.findByRole('heading', { name: 'Your wishlists' });

    // The session refreshes (the currency prompt's answer), and the lists are
    // read again: that read fails.
    answers.lists = () => serverError('Failed to fetch wishlists');
    const reads = requested('/api/wishlists');
    act(() => auth.set('loading'));
    act(() => auth.set('authenticated'));
    await settle();

    expect(requested('/api/wishlists')).toBe(reads + 1);
    expect(screen.getByRole('heading', { name: 'Your wishlists' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Couldn’t load your wishlists' })).toBeNull();
    expect(showToast).toHaveBeenCalledWith('Failed to load wishlists', 'error');
  });
});
