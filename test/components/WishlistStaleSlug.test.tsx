// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { push, replace, showToast } = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { user: { id: 'alice', username: 'alice' } },
    status: 'authenticated',
  }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
  useParams: () => ({ id: 'birthday' }),
}));

vi.mock('@/components/AppHeader', () => ({ default: () => null }));
vi.mock('@/components/AuthButton', () => ({ default: () => null }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));

import WishlistDetail from '@/app/wishlists/[id]/page';
import { openListTab } from './listMenu';

const loaded = {
  _id: 'w1',
  name: 'Birthday',
  slug: 'birthday',
  description: 'Things I would like',
  owners: ['alice', 'bob'],
  visibility: 'everyone',
  archived: false,
  featured: false,
  currency: 'EUR',
  bannerUrl: null,
  occasion: null,
};

const reply = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
});

const fetchMock = vi.fn();
/** Every request the page sent once the slug had changed, as "METHOD url". */
let sent: string[];
/** Set once the page has loaded: a co-owner has given the list a new slug, so `birthday` leads nowhere. */
let slugChanged: boolean;

beforeEach(() => {
  fetchMock.mockReset();
  showToast.mockReset();
  sent = [];
  slugChanged = false;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (slugChanged && url.startsWith('/api/wishlists/birthday')) {
      return reply({ success: false, error: 'Wishlist not found' }, 404);
    }
    if (slugChanged) sent.push(`${method} ${url}`);
    const byId = '/api/wishlists/w1';
    if ((url === '/api/wishlists/birthday' || url === byId) && method === 'GET') {
      return reply({
        success: true,
        data: {
          ...loaded,
          slug: slugChanged ? 'annas-30th' : 'birthday',
          userRole: 'owner',
          ownerUsernames: ['alice', 'bob'],
        },
      });
    }
    if (url === byId && method === 'PATCH') {
      return reply({
        success: true,
        data: { ...loaded, ...JSON.parse(String(init?.body)), slug: 'annas-30th' },
      });
    }
    if (url === `${byId}/items` && method === 'POST') {
      const body = JSON.parse(String(init?.body));
      return reply(
        { success: true, data: { _id: 'i1', wishlist: 'w1', status: 'available', ...body } },
        201
      );
    }
    if (url.endsWith('/items') || url.includes('/members') || url.includes('/invites')) {
      return reply({ success: true, data: [] });
    }
    return reply({ success: false, error: 'Not mocked' }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('a page left open on a list whose URL a co-owner has changed', () => {
  // regression: every write and side read of the wishlist page went by the slug in
  // its URL, so once a co-owner gave the list a new one, a settings save, the people
  // reads and Add item all answered "Wishlist not found" until the page was reloaded.
  it('regression: still saves settings and adds items, addressing the list by its id', async () => {
    const user = userEvent.setup();
    render(<WishlistDetail />);
    await openListTab(user, 'Settings');
    await screen.findByRole('heading', { name: 'About' });
    slugChanged = true;

    await user.type(screen.getByLabelText('Description'), '!');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('Wishlist updated successfully', 'success')
    );
    expect(sent).toContain('PATCH /api/wishlists/w1');

    await user.click(screen.getAllByRole('button', { name: 'Add item' })[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Add new item' });
    await user.type(within(dialog).getByLabelText(/item name/i), 'Bike');
    await user.click(within(dialog).getByRole('button', { name: 'Add to list' }));
    await waitFor(() => expect(sent).toContain('POST /api/wishlists/w1/items'));
    expect(showToast).toHaveBeenCalledWith('Item added successfully', 'success');
  });

  it('regression: reads the people by the list’s id too', async () => {
    const user = userEvent.setup();
    render(<WishlistDetail />);
    await screen.findByRole('tab', { name: /People/ });
    slugChanged = true;
    await user.click(screen.getByRole('tab', { name: /People/ }));
    await waitFor(() => expect(sent).toContain('GET /api/wishlists/w1/members'));
    expect(sent).toContain('GET /api/wishlists/w1/invites');
  });
});
