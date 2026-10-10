// @vitest-environment jsdom
// The search inside a list (WIS-389): name and notes, over the items already
// loaded, kept in the URL's ?q= (replaceState, so no history entries), and
// combined with the status chips.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ApiItem } from '@/types/api';

const { router, params } = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
  params: { id: 'birthday' },
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { user: { id: 'carol', username: 'carol', defaultCurrency: 'EUR' } },
    status: 'authenticated',
  }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => router, useParams: () => params }));
vi.mock('@/components/AppHeader', () => ({ default: () => null }));
vi.mock('@/components/AuthButton', () => ({ default: () => null }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast: vi.fn() }) }));

import WishlistDetail from '@/app/wishlists/[id]/page';

let userRole: 'owner' | 'member';

const reply = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
});

function item(name: string, fields: Partial<ApiItem>, day: number): ApiItem {
  return {
    _id: `birthday-${name}`,
    wishlist: 'birthday',
    name,
    status: 'available',
    createdAt: `2026-01-${String(day).padStart(2, '0')}T00:00:00.000Z`,
    updatedAt: `2026-01-${String(day).padStart(2, '0')}T00:00:00.000Z`,
    ...fields,
  } as ApiItem;
}

const ITEMS = (): ApiItem[] => [
  item('Lamp', { notes: 'Brass, from the Ikea near the station' }, 1),
  item('Kettle', {}, 2),
  item('Vase', { notes: 'Blue', status: 'completed' }, 3),
  item('Sketch', { status: 'draft', notes: 'ikea frame' }, 4),
];

const fetchMock = vi.fn();

beforeEach(() => {
  localStorage.clear();
  params.id = 'birthday';
  window.history.replaceState(null, '', '/wishlists/birthday');
  userRole = 'member';
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const list = /^\/api\/wishlists\/([^/]+)(\/items)?$/.exec(url);
    if (list && method === 'GET') {
      if (list[2]) {
        const all = ITEMS();
        return reply({
          success: true,
          data:
            userRole === 'owner'
              ? [...all, item('Rug', { status: 'booked', bookedBy: 'dave', proposedBy: 'erin' }, 5)]
              : all.filter((i) => i.status !== 'draft'),
        });
      }
      return reply({
        success: true,
        data: {
          _id: 'w-birthday',
          name: 'Birthday',
          slug: 'birthday',
          description: '',
          owners: userRole === 'owner' ? ['carol'] : ['alice'],
          ownerUsernames: userRole === 'owner' ? ['carol'] : ['alice'],
          userRole,
          visibility: 'everyone',
          archived: false,
          featured: false,
          currency: 'EUR',
          bannerUrl: null,
          occasion: null,
        },
      });
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

const shown = () =>
  screen.queryAllByRole('article').map((a) => a.getAttribute('aria-label')?.replace('Item: ', ''));
const searchBox = () => screen.getByRole('textbox', { name: 'Search items' });

async function open() {
  render(<WishlistDetail />);
  await screen.findByRole('heading', { level: 1, name: 'Birthday' });
  await waitFor(() => expect(screen.queryAllByRole('article').length).toBeGreaterThan(0));
}

/** Opens a list whose search hides every item, so there are no cards to wait for. */
async function openWithNoMatch() {
  render(<WishlistDetail />);
  await screen.findByRole('heading', { name: 'No items found' });
}

describe('searching inside a list', () => {
  it('narrows the items by name or notes and writes the query to ?q= without a history entry', async () => {
    await open();
    const user = userEvent.setup();
    const before = window.history.length;
    await user.type(searchBox(), 'ikea');
    expect(shown()).toEqual(['Lamp']);
    expect(window.location.search).toBe('?q=ikea');
    expect(window.history.length).toBe(before);

    await user.clear(searchBox());
    expect(window.location.search).toBe('');
    expect(shown()).toHaveLength(3);
  });

  it('opens a list at ?q= already searched, keeping other params', async () => {
    window.history.replaceState(null, '', '/wishlists/birthday?q=kettle&show=available');
    await open();
    expect(searchBox()).toHaveValue('kettle');
    expect(shown()).toEqual(['Kettle']);
    expect(window.location.search).toContain('q=kettle');
    expect(window.location.search).toContain('show=available');
  });

  it('combines with a status chip', async () => {
    await open();
    const user = userEvent.setup();
    await user.type(searchBox(), 'blue');
    expect(shown()).toEqual(['Vase']);
    await user.click(screen.getByRole('radio', { name: /^Available/ }));
    // The one match is received, not available.
    expect(screen.getByRole('heading', { name: 'No items found' })).toBeInTheDocument();
    expect(screen.getByText('No items match “blue”.')).toBeInTheDocument();
  });

  it('shows the no-match empty state, and Show all clears the query and the URL', async () => {
    window.history.replaceState(null, '', '/wishlists/birthday?q=zzz');
    await openWithNoMatch();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Show all' }));
    expect(searchBox()).toHaveValue('');
    expect(window.location.search).toBe('');
    expect(shown()).toHaveLength(3);
  });

  it("gives an owner no way to find a booking: the search reads only what's shown", async () => {
    userRole = 'owner';
    await open();
    const user = userEvent.setup();
    for (const q of ['booked', 'dave', 'erin']) {
      await user.clear(searchBox());
      await user.type(searchBox(), q);
      expect(screen.getByRole('heading', { name: 'No items found' })).toBeInTheDocument();
    }
    await user.clear(searchBox());
    await user.type(searchBox(), 'rug');
    expect(shown()).toEqual(['Rug']);
    await user.clear(searchBox());
    await user.type(searchBox(), 'ikea');
    expect(shown()).toEqual(['Sketch', 'Lamp']);
  });

  it('expands from an icon on a phone and stays open while it holds text', async () => {
    await open();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Open search' }));
    expect(searchBox()).toHaveFocus();
    await user.type(searchBox(), 'v');
    expect(screen.queryByRole('button', { name: 'Open search' })).toBeNull();
  });

  // regression: a field shown only for a ?q= link folded away (and dropped
  // focus) the moment it was cleared.
  it('stays open and focused when a ?q= field is cleared', async () => {
    window.history.replaceState(null, '', '/wishlists/birthday?q=ikea');
    await open();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(searchBox()).toHaveValue('');
    expect(searchBox()).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Open search' })).toBeNull();
  });

  // regression: clearing the query from outside left the field expanded.
  it('folds back to the icon when the query is cleared from outside', async () => {
    window.history.replaceState(null, '', '/wishlists/birthday?q=zzz');
    await openWithNoMatch();
    expect(screen.queryByRole('button', { name: 'Open search' })).toBeNull();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Show all' }));
    expect(await screen.findByRole('button', { name: 'Open search' })).toBeInTheDocument();
  });
});
