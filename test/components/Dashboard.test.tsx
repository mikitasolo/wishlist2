// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';

const { showToast, auth } = vi.hoisted(() => {
  // The session's status, which the dashboard reads its lists again on:
  // next-auth's `update()` (the currency prompt's) turns it to `loading` and back.
  let status = 'authenticated';
  // The signed-in account: another can sign in from another tab, with the
  // status staying 'authenticated'.
  let userId = 'me';
  const listeners = new Set<() => void>();
  return {
    showToast: vi.fn(),
    auth: {
      status: () => status,
      userId: () => userId,
      set(next: string) {
        status = next;
        listeners.forEach((listener) => listener());
      },
      signInAs(next: string) {
        userId = next;
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
    useSession: () => {
      const id = useSyncExternalStore(auth.subscribe, auth.userId);
      return {
        // Answered the currency prompt already: it's `NeedsYou.test.tsx`'s.
        data: { user: { id, username: id, currencyChosen: true } },
        status: useSyncExternalStore(auth.subscribe, auth.status),
        update: vi.fn(),
      };
    },
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
// about the dashboard's own reads and blocks (WIS-252). Needs you is the real
// one, so its reads are answered here too (`NeedsYou.test.tsx` has the rest).
vi.mock('@/components/AppHeader', () => ({ default: () => null }));
vi.mock('@/components/AuthButton', () => ({ default: () => null }));
vi.mock('@/components/GlobalSearch', () => ({ default: () => null }));
vi.mock('@/components/CreateWishlistModal', () => ({
  default: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div role="dialog" aria-label="Create new wishlist" /> : null,
}));
vi.mock('@/components/ShareButton', () => ({ default: () => null }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));

import Home from '@/app/page';
import { atWidth } from './viewport';

function list(id: string, name: string, fields: Record<string, unknown> = {}) {
  return {
    _id: id,
    slug: name.toLowerCase().replace(/\W+/g, '-'),
    name,
    visibility: 'everyone',
    itemCount: 2,
    owners: ['me'],
    featured: false,
    occasion: null,
    ...fields,
  };
}

const owned = [list('w1', 'Birthday')];

type Response = { ok: boolean; status: number; json: () => Promise<unknown> };

function json(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body };
}
const serverError = (error: string) => json({ success: false, error }, 500);

/** What each read is answered with: a response (possibly held), or a network failure. */
type Answer = () => Response | Promise<Response>;
let answers: { lists: Answer; invites: Answer; summary: Answer; pin: Answer };
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  auth.signInAs('me');
  // Desktop width: the lists are cards (a phone gets rows, `WishlistList.test.tsx`).
  atWidth(1280);
  auth.set('authenticated');
  showToast.mockReset();
  answers = {
    lists: () => json({ success: true, data: { owned, member: [] } }),
    invites: () => json({ success: true, data: [] }),
    summary: () => json({ success: true, data: { changed: 0 } }),
    pin: () => json({ success: true, data: {} }),
  };
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith('/api/wishlists/') && init?.method === 'PATCH') return answers.pin();
    if (url === '/api/wishlists') return answers.lists();
    if (url === '/api/users/me/invites') return answers.invites();
    if (url === '/api/users/me/reservations/summary') return answers.summary();
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

/** Let reads whose answers the page has taken finish landing. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

const requested = (url: string) => fetchMock.mock.calls.filter(([u]) => u === url).length;

describe('dashboard — the greeting row', () => {
  it('greets you with New list beside it, and no counts, follows, tiles or Featured', async () => {
    render(<Home />);
    await screen.findByRole('heading', { level: 2, name: 'Your wishlists' });
    await settle();

    const greeting = screen.getByRole('heading', { level: 1 });
    expect(greeting).toHaveTextContent(/^Good (morning|afternoon|evening), me$/);
    const newList = within(greeting.parentElement!).getByRole('button', { name: 'New list' });
    await userEvent.setup().click(newList);
    expect(screen.getByRole('dialog', { name: 'Create new wishlist' })).toBeInTheDocument();

    // No line of counts under it, and followers and following are the profile's.
    expect(screen.queryByText(/in your lists/)).toBeNull();
    expect(screen.queryByRole('button', { name: /followers?/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /following/ })).toBeNull();
    // No stat tiles, no Featured hero and no picker for it.
    expect(screen.queryByRole('region', { name: 'Overview' })).toBeNull();
    expect(screen.queryByRole('link', { name: /Reserved by you/ })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Featured wishlist' })).toBeNull();
    expect(screen.queryByText('Featured')).toBeNull();
    expect(requested('/api/users/me')).toBe(0);
  });

  // regression (WIS-213): the Reserved by you tile showed "0" before its count
  // had loaded, and kept it when the read failed. The tile is gone, and nothing
  // on the dashboard counts reservations in its place: only the gifter's own
  // changed ones, in Needs you, once read.
  it('regression: shows no reservation count while the reads are on their way, nor after one fails', async () => {
    let release!: (response: Response) => void;
    answers.summary = () => new Promise<Response>((resolve) => (release = resolve));
    render(<Home />);
    await screen.findByRole('heading', { level: 2, name: 'Your wishlists' });

    expect(screen.queryByText(/reserv/i)).toBeNull();
    expect(requested('/api/users/me/reservations/count')).toBe(0);
    expect(requested('/api/users/me/reservations')).toBe(0);

    await act(async () => release(serverError('Failed to summarize reservations')));
    await settle();
    expect(screen.queryByText(/reserv/i)).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Needs you' })).toBeNull();
    expect(showToast).not.toHaveBeenCalled();
  });
});

describe('dashboard — Needs you on the page', () => {
  it('shows your proposals to review from your lists, once they are read', async () => {
    answers.lists = () =>
      json({
        success: true,
        data: {
          owned: [list('w1', 'Birthday', { proposalCount: 2 })],
          member: [],
        },
      });
    render(<Home />);
    const needsYou = (await screen.findByRole('heading', { name: 'Needs you' })).closest(
      'section'
    )!;
    expect(within(needsYou).getByText('2 proposals to review')).toBeInTheDocument();
    expect(
      within(needsYou).getByRole('link', { name: 'Review proposals on Birthday' })
    ).toHaveAttribute('href', '/wishlists/birthday?show=proposals');
  });

  it('still shows an invitation when your lists could not be read', async () => {
    answers.lists = () => serverError('Failed to fetch wishlists');
    answers.invites = () =>
      json({
        success: true,
        data: [
          {
            _id: 'i1',
            role: 'member',
            wishlistId: 'w9',
            wishlistName: 'Lena’s wedding',
            wishlistSlug: 'lena',
            invitedByUsername: 'lena',
            invitedByImage: null,
          },
        ],
      });
    render(<Home />);
    await screen.findByRole('heading', { name: 'Couldn’t load your wishlists' });
    const needsYou = (await screen.findByRole('heading', { name: 'Needs you' })).closest(
      'section'
    )!;
    expect(within(needsYou).getByText('Lena’s wedding')).toBeInTheDocument();
    expect(within(needsYou).getByRole('button', { name: 'Accept' })).toBeInTheDocument();
  });
});

describe('dashboard — Pin to top', () => {
  const three = () => [
    list('w1', 'Books'),
    list('w2', 'Garden', { featured: true }),
    list('w3', 'Kitchen'),
  ];

  /** The names of Your wishlists' cards, top to bottom. */
  const order = () =>
    within(screen.getByRole('heading', { level: 2, name: 'Your wishlists' }).closest('section')!)
      .getAllByRole('heading', { level: 3 })
      .map((h) => h.textContent);

  it('puts your pinned list first, and pinning another moves it there and unpins the first', async () => {
    answers.lists = () => json({ success: true, data: { owned: three(), member: [] } });
    render(<Home />);
    await screen.findByRole('heading', { level: 2, name: 'Your wishlists' });
    expect(order()).toEqual(['Garden', 'Books', 'Kitchen']);

    const card = (name: string) =>
      screen.getByRole('heading', { level: 3, name }).closest('a')!.parentElement!;
    expect(
      within(card('Garden')).getByRole('button', { name: 'Pin to top', pressed: true })
    ).toBeInTheDocument();
    await userEvent
      .setup()
      .click(within(card('Kitchen')).getByRole('button', { name: 'Pin to top', pressed: false }));

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/wishlists/w3',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ featured: true }) })
    );
    expect(order()).toEqual(['Kitchen', 'Books', 'Garden']);
    expect(
      within(card('Garden')).getByRole('button', { name: 'Pin to top', pressed: false })
    ).toBeInTheDocument();
    expect(
      within(card('Kitchen')).getByRole('button', { name: 'Pin to top', pressed: true })
    ).toBeInTheDocument();
  });

  it('Unpin puts the list back in its place', async () => {
    answers.lists = () => json({ success: true, data: { owned: three(), member: [] } });
    render(<Home />);
    await screen.findByRole('heading', { level: 2, name: 'Your wishlists' });
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Pin to top', pressed: true }));

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/wishlists/w2',
      expect.objectContaining({ body: JSON.stringify({ featured: false }) })
    );
    expect(order()).toEqual(['Books', 'Garden', 'Kitchen']);
  });

  it('keeps the order, and says so, when the pin is refused', async () => {
    answers.lists = () => json({ success: true, data: { owned: three(), member: [] } });
    answers.pin = () => json({ success: false, error: 'Nope' }, 403);
    render(<Home />);
    await screen.findByRole('heading', { level: 2, name: 'Your wishlists' });
    await userEvent
      .setup()
      .click(screen.getAllByRole('button', { name: 'Pin to top', pressed: false })[0]);

    expect(showToast).toHaveBeenCalledWith('Nope', 'error');
    expect(order()).toEqual(['Garden', 'Books', 'Kitchen']);
  });

  it('offers no pin on a list shared with you', async () => {
    answers.lists = () =>
      json({
        success: true,
        data: {
          owned: [],
          member: [list('s1', 'Friend’s', { owners: ['f'], userRole: 'member' })],
        },
      });
    render(<Home />);
    await screen.findByRole('heading', { level: 2, name: 'Shared with you' });
    expect(screen.queryByRole('button', { name: /Pin to top|Unpin/ })).toBeNull();
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
      expect(screen.queryByRole('button', { name: /Create wishlist/ })).toBeNull();
      // Nor a Coming up or a Needs you that would claim there's nothing.
      expect(screen.queryByRole('heading', { name: 'Coming up' })).toBeNull();
      expect(screen.queryByRole('heading', { name: 'Needs you' })).toBeNull();
      expect(showToast).not.toHaveBeenCalled();

      answers.lists = () => json({ success: true, data: { owned, member: [] } });
      const reads = requested('/api/wishlists');
      await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));

      expect(await screen.findByRole('heading', { name: 'Your wishlists' })).toBeInTheDocument();
      expect(screen.getAllByText('Birthday').length).toBeGreaterThan(0);
      expect(screen.queryByRole('heading', { name: 'Couldn’t load your wishlists' })).toBeNull();
      expect(requested('/api/wishlists')).toBe(reads + 1);
      expect(showToast).not.toHaveBeenCalled();
    }
  );

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

  // Another account signing in (from another tab) keeps the status
  // 'authenticated': its lists are read as a first load, and the previous
  // account's never sit beside its Needs you.
  it('reads the lists afresh, as a first load, when another account signs in', async () => {
    answers.lists = () =>
      json({
        success: true,
        data: { owned: [list('w1', 'Birthday', { proposalCount: 2 })], member: [] },
      });
    render(<Home />);
    await screen.findByText('2 proposals to review');

    answers.lists = () => serverError('Failed to fetch wishlists');
    act(() => auth.signInAs('someone-else'));

    expect(
      await screen.findByRole('heading', { name: 'Couldn’t load your wishlists' })
    ).toBeInTheDocument();
    expect(screen.queryByText('Birthday')).toBeNull();
    expect(screen.queryByText('2 proposals to review')).toBeNull();
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
