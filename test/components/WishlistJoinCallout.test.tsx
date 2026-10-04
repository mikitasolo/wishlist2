// @vitest-environment jsdom
// The wishlist page's "Want to reserve a gift?" note: shown to anyone who isn't
// on the list (signed out, or signed in but neither an owner nor a member), and
// never to its owners or members.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
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
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  useParams: () => ({ id: 'birthday' }),
}));
vi.mock('@/components/AppHeader', () => ({ default: () => null }));
vi.mock('@/components/AuthButton', () => ({ default: () => null }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));

import WishlistDetail from '@/app/wishlists/[id]/page';

let list: { owners: string[]; userRole: 'owner' | 'member' | null };

const reply = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
});
const fetchMock = vi.fn();

const ITEMS = [
  { _id: 'i1', wishlist: 'w1', name: 'Kettle', status: 'available' },
  { _id: 'i2', wishlist: 'w1', name: 'Lamp', status: 'completed' },
];

beforeAll(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterAll(() => vi.restoreAllMocks());

beforeEach(() => {
  fetchMock.mockReset();
  signIn.mockReset();
  window.history.pushState({}, '', '/wishlists/birthday');
  list = { owners: ['anna_m'], userRole: null };
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url === '/api/wishlists/birthday' && method === 'GET') {
      return reply({
        success: true,
        data: {
          _id: 'w1',
          name: 'Birthday',
          slug: 'birthday',
          description: '',
          owners: list.owners.map((_, i) => `u${i}`),
          ownerUsernames: [...list.owners],
          userRole: list.userRole,
          visibility: 'everyone',
          archived: false,
          featured: false,
          currency: 'EUR',
          bannerUrl: null,
          occasion: null,
        },
      });
    }
    if (url.startsWith('/api/wishlists/birthday/items') && method === 'GET') {
      return reply({ success: true, data: ITEMS });
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

/** Waits for the list (and its items) to be on screen. */
async function listShown() {
  await screen.findByRole('heading', { level: 1, name: 'Birthday' });
  await screen.findByText('Kettle');
}

const callout = () => screen.queryByText(/Want to reserve a gift\?/);

describe('the wishlist page’s note on getting invited', () => {
  it('shows a signed-out visitor who can reserve, and Sign in back to this list', async () => {
    viewAs(null);
    const user = userEvent.setup();
    render(<WishlistDetail />);
    await listShown();

    expect(callout()).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent(
      'Only people @anna_m invites can reserve items'
    );
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(signIn).toHaveBeenCalledWith(undefined, {
      redirectTo: `${window.location.origin}/wishlists/birthday`,
    });
  });

  it('lets a signed-in non-member ask to join, and cancel the request', async () => {
    viewAs({ id: 'ivan', username: 'ivan_petrov' });
    list = { owners: ['anna_m', 'chloe_r'], userRole: null };
    const user = userEvent.setup();
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (url === '/api/wishlists/w1/requests' && method === 'POST') {
        return reply({ success: true, data: { requested: true } }, 201);
      }
      if (url === '/api/wishlists/w1/requests/me' && method === 'DELETE') {
        return reply({ success: true, data: { requested: false } });
      }
      if (url === '/api/wishlists/w1/requests/me') {
        return reply({ success: true, data: { requested: false } });
      }
      return base(url, init);
    });
    render(<WishlistDetail />);
    await listShown();

    const note = screen.getByRole('note');
    expect(note).toHaveTextContent('Only people @anna_m and @chloe_r invite can reserve items');
    expect(note).toHaveTextContent('Ask to join, and they can invite you.');
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();

    await user.click(await screen.findByRole('button', { name: 'Ask to join' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/wishlists/w1/requests', { method: 'POST' });
    expect(await screen.findByRole('button', { name: 'Requested' })).toBeDisabled();
    expect(showToast).toHaveBeenCalledWith('Request sent to the owners', 'success');

    await user.click(screen.getByRole('button', { name: 'Cancel request' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/wishlists/w1/requests/me', { method: 'DELETE' });
    expect(await screen.findByRole('button', { name: 'Ask to join' })).toBeEnabled();
  });

  it('shows Requested to someone who has already asked', async () => {
    viewAs({ id: 'ivan', username: 'ivan_petrov' });
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
      url === '/api/wishlists/w1/requests/me'
        ? reply({ success: true, data: { requested: true } })
        : base(url, init)
    );
    render(<WishlistDetail />);
    await listShown();
    expect(await screen.findByRole('button', { name: 'Requested' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel request' })).toBeInTheDocument();
  });

  it.each([
    { who: 'a member', role: 'member' as const },
    { who: 'an owner', role: 'owner' as const },
  ])('isn’t shown to $who', async ({ role }) => {
    viewAs({ id: 'carol', username: 'carol' });
    list = { owners: role === 'owner' ? ['carol'] : ['anna_m'], userRole: role };
    render(<WishlistDetail />);
    await listShown();

    expect(callout()).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ask to join' })).toBeNull();
    // A member or an owner has nothing to ask, so their state is never read.
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/requests'))).toBe(false);
  });
});
