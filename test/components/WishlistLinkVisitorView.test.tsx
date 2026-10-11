// @vitest-environment jsdom
// A signed-out share link visitor's `/l/<token>` page draws the list's top
// (name, owners, the visitor's note) from what the server read (`visitorView`,
// WIS-447) while its own reads load, so the largest text is there from the
// first paint. Anyone the browser finds signed in gets the skeleton instead,
// so an owner or member is never shown the visitor's view.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import userEvent from '@testing-library/user-event';

const { router, signIn, auth } = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
  signIn: vi.fn(),
  auth: {
    session: { data: null, status: 'loading' } as {
      data: { user: { id: string; username?: string } } | null;
      status: string;
    },
  },
}));

vi.mock('next-auth/react', () => ({ useSession: () => auth.session, signIn }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/components/AppHeader', () => ({ default: () => null }));
vi.mock('@/components/AuthButton', () => ({ default: () => null }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));

import WishlistPage, { type WishlistAddress } from '@/components/WishlistPage';
import { KEEP_LINK_TEXT } from '@/components/JoinListCallout';
import type { LinkVisitorView } from '@/lib/utils/linkVisitorView';
import { OccasionMeta } from '@/components/WishlistHeader';

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUv';
const fetchMock = vi.fn();

const VIEW: LinkVisitorView = {
  name: 'Wedding',
  ownerUsernames: ['anna_m'],
  ownerCount: 1,
  occasion: null,
  visibility: 'private',
  bannerUrl: null,
  description: 'Things for the new flat',
  todayHint: '2026-10-11',
};

/** The list as its own read answers a signed-out link visitor. */
const LIST = {
  _id: 'w1',
  name: 'Wedding',
  slug: 'wedding',
  description: 'Things for the new flat',
  owners: ['u0'],
  ownerUsernames: ['anna_m'],
  userRole: null,
  visibility: 'private',
  archived: false,
  featured: false,
  currency: 'EUR',
  bannerUrl: null,
  occasion: null,
};
const reply = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

beforeAll(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterAll(() => vi.restoreAllMocks());

beforeEach(() => {
  fetchMock.mockReset();
  signIn.mockReset();
  router.replace.mockReset();
  window.history.pushState({}, '', `/l/${TOKEN}`);
  // The page's reads never land here: what's on screen is what it drew before them.
  fetchMock.mockImplementation(() => new Promise(() => {}));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function session(status: 'loading' | 'unauthenticated' | 'authenticated') {
  auth.session =
    status === 'authenticated'
      ? { data: { user: { id: 'u1', username: 'member' } }, status }
      : { data: null, status };
}

const link = (
  extra: Partial<Extract<WishlistAddress, { kind: 'link' }>> = {}
): WishlistAddress => ({
  kind: 'link',
  token: TOKEN,
  listId: 'w1',
  visitorView: VIEW,
  ...extra,
});

describe('a signed-out visitor’s share link page before its reads land', () => {
  it('draws the list’s name, owners, description and the visitor’s note at once', () => {
    session('loading');
    render(<WishlistPage address={link()} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Wedding' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '@anna_m' })).toBeTruthy();
    expect(screen.getByText('Things for the new flat')).toBeTruthy();
    expect(screen.getByText('Want to reserve a gift?')).toBeTruthy();
    expect(screen.getByText(KEEP_LINK_TEXT)).toBeTruthy();
    // A visitor's actions only: Share, never Propose or the list's ⋯ menu.
    expect(screen.queryByRole('button', { name: /propose/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /more list actions/i })).toBeNull();
  });

  it('keeps it once the browser knows nobody is signed in', () => {
    session('unauthenticated');
    render(<WishlistPage address={link()} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Wedding' })).toBeTruthy();
  });

  it('offers Sign in to ask to join, back to the link with then=ask', async () => {
    session('unauthenticated');
    const user = userEvent.setup();
    render(<WishlistPage address={link()} />);
    await user.click(screen.getByRole('button', { name: 'Sign in to ask to join' }));
    expect(signIn).toHaveBeenCalledWith(undefined, { redirectTo: `/l/${TOKEN}?then=ask` });
  });

  it('offers Sign in to join on a Join link', () => {
    session('loading');
    render(<WishlistPage address={link({ level: 'join' })} />);
    expect(screen.getByText(/Join the list so nobody buys/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign in to join' })).toBeTruthy();
  });

  it('shows the skeleton, never the visitor’s view, once the browser finds someone signed in', () => {
    // They signed in elsewhere after the server drew the page: an owner or member, maybe.
    session('authenticated');
    render(<WishlistPage address={link()} />);
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(screen.queryByText('Want to reserve a gift?')).toBeNull();
  });

  it('shows the skeleton without a view from the server (anyone signed in)', () => {
    session('loading');
    render(<WishlistPage address={link({ visitorView: undefined })} />);
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(screen.queryByText('Want to reserve a gift?')).toBeNull();
  });
});

// Its own list id, so nothing the earlier tests left keyed by w1 (their reads
// never answer) carries over.
describe('once the reads land', () => {
  it('keeps the same header and note, not redrawn, and adds the items', async () => {
    session('unauthenticated');
    let answerList: (value: unknown) => void = () => {};
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/wishlists/w2') return new Promise((r) => (answerList = r));
      if (url === '/api/wishlists/w2/items') {
        return Promise.resolve(
          reply({
            success: true,
            data: [{ _id: 'i1', wishlist: 'w2', name: 'Kettle', status: 'available' }],
          })
        );
      }
      return Promise.resolve(reply({ success: true, data: [] }));
    });
    render(<WishlistPage address={link({ listId: 'w2' })} />);
    const heading = screen.getByRole('heading', { level: 1, name: 'Wedding' });
    const note = screen.getByText('Want to reserve a gift?');
    await act(async () => answerList(reply({ success: true, data: { ...LIST, _id: 'w2' } })));
    await screen.findByText('Kettle');
    // The very same nodes: the loaded page's top lines up with the server's.
    expect(screen.getByRole('heading', { level: 1, name: 'Wedding' })).toBe(heading);
    expect(screen.getByText('Want to reserve a gift?')).toBe(note);
  });

  it('shows the read’s newer list over the server’s while the session is still loading', async () => {
    session('loading');
    fetchMock.mockImplementation((url: string) =>
      url === '/api/wishlists/w2'
        ? Promise.resolve(
            reply({ success: true, data: { ...LIST, _id: 'w2', name: 'Wedding (renamed)' } })
          )
        : new Promise(() => {})
    );
    render(<WishlistPage address={link({ listId: 'w2' })} />);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Wedding (renamed)' })
    ).toBeTruthy();
  });
});

describe('the occasion on a server-drawn header', () => {
  const occasion = { kind: 'birthday' as const, date: '2000-10-25', recurrence: 'yearly' as const };

  it('holds the date and countdown’s place, unseen, until the browser’s date is known', () => {
    const html = renderToString(<OccasionMeta occasion={occasion} todayHint="2026-10-11" />);
    expect(html).toMatch(/aria-hidden="true" class="invisible"/);
    expect(html).toContain('in 14 days');
    // Nothing visible claims a date the browser hasn't confirmed.
    expect(html).not.toContain('<time');
  });

  it('shows the browser’s own date, with nothing held, once it is known', () => {
    render(<OccasionMeta occasion={occasion} todayHint="2026-10-11" />);
    expect(document.querySelector('.invisible')).toBeNull();
    expect(document.querySelector('time')).not.toBeNull();
  });
});
