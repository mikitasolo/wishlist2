// @vitest-environment jsdom
// A list opened through its share link, `/l/<token>` (WIS-335): every read and
// the join request carry the token in `X-Share-Token`, owners and members go on
// to the list's own URL (unless previewing), visitors get the link-mode callout,
// and any refusal is the dead-link state.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { router, showToast, signIn, auth } = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
  showToast: vi.fn(),
  signIn: vi.fn(),
  auth: {
    session: { data: null, status: 'unauthenticated' } as {
      data: { user: { id: string; username?: string } } | null;
      status: string;
    },
  },
}));

vi.mock('next-auth/react', () => ({ useSession: () => auth.session, signIn }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/components/AppHeader', () => ({ default: () => null }));
vi.mock('@/components/AuthButton', () => ({ default: () => null }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));

import WishlistPage, { type WishlistAddress } from '@/components/WishlistPage';
import { KEEP_LINK_TEXT } from '@/components/JoinListCallout';

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUv';
const reply = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
});
const fetchMock = vi.fn();

let role: 'owner' | 'member' | null;
let refused: boolean;

const ITEMS = [
  { _id: 'i1', wishlist: 'w1', name: 'Kettle', status: 'available' },
  { _id: 'i2', wishlist: 'w1', name: 'Secret draft', status: 'draft' },
];

beforeAll(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterAll(() => vi.restoreAllMocks());

beforeEach(() => {
  fetchMock.mockReset();
  signIn.mockReset();
  router.replace.mockReset();
  window.history.pushState({}, '', `/l/${TOKEN}`);
  role = null;
  refused = false;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (refused && url.startsWith('/api/wishlists/w1')) {
      return reply({ success: false, error: 'Wishlist not found' }, 404);
    }
    if (url === '/api/wishlists/w1' && method === 'GET') {
      return reply({
        success: true,
        data: {
          _id: 'w1',
          name: 'Wedding',
          slug: 'wedding',
          description: '',
          owners: ['u0'],
          ownerUsernames: ['anna_m'],
          userRole: role,
          visibility: 'private',
          archived: false,
          featured: false,
          currency: 'EUR',
          bannerUrl: null,
          occasion: null,
        },
      });
    }
    if (url === '/api/wishlists/w1/items' && method === 'GET') {
      // An owner's read has the draft; a visitor's wouldn't.
      return reply({
        success: true,
        data: role === 'owner' ? ITEMS : ITEMS.filter((i) => i.status !== 'draft'),
      });
    }
    if (url === '/api/wishlists/w1/requests/me') {
      return reply({ success: true, data: { requested: false } });
    }
    if (method === 'GET') return reply({ success: true, data: [] });
    return reply({ success: false, error: 'Not mocked' }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function viewAs(user: { id: string; username?: string } | null) {
  auth.session = user
    ? { data: { user }, status: 'authenticated' }
    : { data: null, status: 'unauthenticated' };
}

const link = (
  extra: Partial<Extract<WishlistAddress, { kind: 'link' }>> = {}
): WishlistAddress => ({
  kind: 'link',
  token: TOKEN,
  listId: 'w1',
  ...extra,
});

const tokenOf = (init?: RequestInit) =>
  new Headers(init?.headers as HeadersInit | undefined).get('X-Share-Token');

describe('a list opened through its share link', () => {
  it('sends the token with every read and never in a URL', async () => {
    viewAs(null);
    render(<WishlistPage address={link()} />);
    await screen.findByText('Kettle');
    const reads = fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/wishlists'));
    expect(reads.length).toBeGreaterThanOrEqual(2);
    for (const [url, init] of reads) {
      expect(tokenOf(init)).toBe(TOKEN);
      expect(String(url)).not.toContain(TOKEN);
    }
  });

  it('offers a signed-out visitor Sign in to ask to join, back to the link with then=ask', async () => {
    viewAs(null);
    const user = userEvent.setup();
    render(<WishlistPage address={link()} />);
    await screen.findByText('Kettle');
    expect(screen.getByText(KEEP_LINK_TEXT)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sign in to ask to join' }));
    expect(signIn).toHaveBeenCalledWith(undefined, { redirectTo: `/l/${TOKEN}?then=ask` });
    // No Save to my list for a link visitor, and Share shares the link.
    expect(screen.queryByRole('button', { name: /Save to my list/i })).toBeNull();
  });

  it('highlights Ask to join after sign-in, sends nothing by itself, and strips then', async () => {
    viewAs({ id: 'ivan', username: 'ivan_petrov' });
    window.history.pushState({}, '', `/l/${TOKEN}?then=ask`);
    render(<WishlistPage address={link({ then: 'ask' })} />);
    const ask = await screen.findByRole('button', { name: 'Ask to join' });
    expect(ask.className).toContain('ring-2');
    expect(window.location.search).toBe('');
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    // The request read carried the token too.
    const me = fetchMock.mock.calls.find(([url]) => url === '/api/wishlists/w1/requests/me');
    expect(tokenOf(me?.[1])).toBe(TOKEN);
  });

  it('asks to join with the token', async () => {
    viewAs({ id: 'ivan', username: 'ivan_petrov' });
    const user = userEvent.setup();
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/wishlists/w1/requests' && init?.method === 'POST') {
        return reply({ success: true, data: { requested: true } }, 201);
      }
      return base(url, init);
    });
    render(<WishlistPage address={link()} />);
    await user.click(await screen.findByRole('button', { name: 'Ask to join' }));
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(tokenOf(post?.[1])).toBe(TOKEN);
    expect(await screen.findByRole('button', { name: 'Requested' })).toBeInTheDocument();
  });

  it('sends an owner or member on to the list’s own URL', async () => {
    for (const r of ['owner', 'member'] as const) {
      role = r;
      viewAs({ id: 'u0' });
      render(<WishlistPage address={link()} />);
      await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/wishlists/wedding'));
      cleanup();
      router.replace.mockReset();
    }
  });

  it('shows an owner previewing as a visitor what a visitor sees, without redirecting', async () => {
    role = 'owner';
    viewAs({ id: 'u0', username: 'anna_m' });
    render(<WishlistPage address={link({ preview: true })} />);
    await screen.findByText('Kettle');
    expect(screen.queryByText('Secret draft')).toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('shows the dead-link state on a refusal, the same signed in or out, with no Sign in', async () => {
    refused = true;
    for (const user of [null, { id: 'ivan' }]) {
      viewAs(user);
      render(<WishlistPage address={link()} />);
      expect(
        await screen.findByRole('heading', { name: 'This link doesn’t work anymore' })
      ).toBeInTheDocument();
      expect(screen.getByText('Ask the person who sent it for a new one.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Sign in/ })).toBeNull();
      // Never sent on to the list's own URL.
      expect(router.replace).not.toHaveBeenCalled();
      cleanup();
    }
  });
});

describe('a Join link (WIS-337)', () => {
  const joinLink = (extra: Partial<Extract<WishlistAddress, { kind: 'link' }>> = {}) =>
    link({ level: 'join', ...extra });

  beforeEach(() => {
    router.push.mockReset();
    showToast.mockReset();
    const read = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/wishlists/w1/join' && init?.method === 'POST') {
        return reply({
          success: true,
          data: { joined: true, alreadyMember: false, wishlistId: 'w1', wishlistSlug: 'wedding' },
        });
      }
      return read(url, init);
    });
  });

  const joins = () =>
    fetchMock.mock.calls.filter(([url]) => String(url) === '/api/wishlists/w1/join');

  it('offers Join this list in place of Ask to join, and joins only once confirmed', async () => {
    viewAs({ id: 'u9', username: 'ivan' });
    const user = userEvent.setup();
    render(<WishlistPage address={joinLink()} />);
    await user.click(await screen.findByRole('button', { name: 'Join this list' }));
    expect(screen.queryByRole('button', { name: 'Ask to join' })).toBeNull();
    // Nothing yet: the confirmation is open.
    expect(joins()).toHaveLength(0);
    const dialog = screen.getByRole('alertdialog', { name: 'Join @anna_m’s list?' });
    expect(dialog).toHaveTextContent(
      'You’ll be able to reserve gifts. @anna_m won’t see what you reserve.'
    );
    await user.click(screen.getByRole('button', { name: 'Join' }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/wishlists/wedding?welcome=1'));
    expect(joins()).toHaveLength(1);
    const [url, init] = joins()[0];
    expect(tokenOf(init)).toBe(TOKEN);
    expect(String(url)).not.toContain(TOKEN);
    // The join-request read isn't made on a Join link.
    expect(fetchMock.mock.calls.some(([u]) => String(u) === '/api/wishlists/w1/requests/me')).toBe(
      false
    );
  });

  it('Cancel closes the confirmation and sends nothing', async () => {
    viewAs({ id: 'u9', username: 'ivan' });
    const user = userEvent.setup();
    render(<WishlistPage address={joinLink()} />);
    await user.click(await screen.findByRole('button', { name: 'Join this list' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(joins()).toHaveLength(0);
  });

  it('offers a signed-out visitor Sign in to join, back to the link with then=join', async () => {
    viewAs(null);
    const user = userEvent.setup();
    render(<WishlistPage address={joinLink()} />);
    await user.click(await screen.findByRole('button', { name: 'Sign in to join' }));
    expect(signIn).toHaveBeenCalledWith(undefined, { redirectTo: `/l/${TOKEN}?then=join` });
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('back from signing in (then=join): the confirmation opens at once, and still takes a click', async () => {
    window.history.pushState({}, '', `/l/${TOKEN}?then=join`);
    viewAs({ id: 'u9', username: 'ivan' });
    const user = userEvent.setup();
    render(<WishlistPage address={joinLink({ then: 'join' })} />);
    expect(await screen.findByRole('alertdialog', { name: 'Join @anna_m’s list?' })).toBeTruthy();
    // `then` is stripped, and nothing is sent on load.
    expect(window.location.search).toBe('');
    expect(joins()).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Join' }));
    await waitFor(() => expect(joins()).toHaveLength(1));
  });

  it('a refused join says the link doesn’t work, and stays put', async () => {
    const read = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
      url === '/api/wishlists/w1/join'
        ? reply({ success: false, error: 'Wishlist not found' }, 404)
        : read(url, init)
    );
    viewAs({ id: 'u9', username: 'ivan' });
    const user = userEvent.setup();
    render(<WishlistPage address={joinLink()} />);
    await user.click(await screen.findByRole('button', { name: 'Join this list' }));
    await user.click(screen.getByRole('button', { name: 'Join' }));
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        'This link doesn’t work anymore. Ask the person who sent it for a new one.',
        'error'
      )
    );
    expect(router.push).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('an owner’s Preview as visitor shows no Join', async () => {
    role = 'owner';
    viewAs({ id: 'u0', username: 'anna_m' });
    render(<WishlistPage address={joinLink({ preview: true })} />);
    await screen.findByText('Kettle');
    expect(screen.queryByRole('button', { name: 'Join this list' })).toBeNull();
  });
});
