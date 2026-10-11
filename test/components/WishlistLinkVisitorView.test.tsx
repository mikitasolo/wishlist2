// @vitest-environment jsdom
// A signed-out share link visitor's `/l/<token>` page draws the list's top
// (name, owners, the visitor's note) from what the server read (`visitorView`,
// WIS-447) while its own reads load, so the largest text is there from the
// first paint. Anyone the browser finds signed in gets the skeleton instead,
// so an owner or member is never shown the visitor's view.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
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
};

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
