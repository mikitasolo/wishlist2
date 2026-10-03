// @vitest-environment jsdom
// The item grid's first cell (WIS-242): an owner's dashed Add item tile, a
// member's Propose an item, and nothing for a visitor. Each opens its header
// button's dialog. It shows only with the grid (not on the empty state, a
// failed read or while loading), and only under a chip the new item is sure to
// be listed in, with no search on. Through it, Keep adding saves item after
// item on the page's own add path.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ApiItem } from '@/types/api';

const { router, showToast, auth } = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
  showToast: vi.fn(),
  auth: {
    session: { data: { user: { id: 'carol', username: 'carol' } }, status: 'authenticated' } as {
      data: { user: { id: string; username: string } } | null;
      status: string;
    },
  },
}));

vi.mock('next-auth/react', () => ({ useSession: () => auth.session }));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  useParams: () => ({ id: 'birthday' }),
}));
// The header has its own fetches and tests; this file is about the list.
vi.mock('@/components/AppHeader', () => ({ default: () => null }));
vi.mock('@/components/AuthButton', () => ({ default: () => null }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));
// ImageUpload pulls in react-easy-crop; stub it out.
vi.mock('@/components/ImageUpload', () => ({
  default: () => <div data-testid="image-upload" />,
}));

import WishlistDetail from '@/app/wishlists/[id]/page';

let userRole: 'owner' | 'member' | null;
let listItems: ApiItem[];
let itemsFail: boolean;
let created: number;

const reply = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
});

function item(name: string, fields: Partial<ApiItem> = {}, day = 1): ApiItem {
  return {
    _id: `item-${name}`,
    wishlist: 'w-birthday',
    name,
    status: 'available',
    createdAt: `2026-01-${String(day).padStart(2, '0')}T00:00:00.000Z`,
    updatedAt: `2026-01-${String(day).padStart(2, '0')}T00:00:00.000Z`,
    ...fields,
  } as ApiItem;
}

const fetchMock = vi.fn();

beforeAll(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterAll(() => vi.restoreAllMocks());

beforeEach(() => {
  localStorage.clear();
  auth.session = { data: { user: { id: 'carol', username: 'carol' } }, status: 'authenticated' };
  userRole = 'owner';
  listItems = [item('Lamp'), item('Vase', { status: 'draft' }, 2)];
  itemsFail = false;
  created = 0;
  showToast.mockReset();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url === '/api/wishlists/birthday/items') {
      if (method === 'POST') {
        const body = JSON.parse(String(init?.body));
        created += 1;
        const fresh = item(
          body.name,
          {
            status: body.status ?? 'available',
            proposedBy: body.status === 'proposed' ? 'carol' : undefined,
          },
          10 + created
        );
        listItems = [fresh, ...listItems];
        return reply({ success: true, data: fresh }, 201);
      }
      if (itemsFail) return reply({ success: false, error: 'Failed to fetch items' }, 500);
      return reply({ success: true, data: listItems });
    }
    if (url === '/api/wishlists/birthday' && method === 'GET') {
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
          isPublic: true,
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

const ANSWERS =
  /^(Your list is empty|Nothing here yet|No items yet|No items found|Couldn’t load this list’s items)$/;

async function open() {
  render(<WishlistDetail />);
  await screen.findByRole('heading', { level: 1, name: 'Birthday' });
  await waitFor(() =>
    expect(
      screen.queryAllByRole('article').length +
        screen.queryAllByRole('heading', { name: ANSWERS }).length
    ).toBeGreaterThan(0)
  );
}

/** The grid's cells, by what they're named: the tile's label, or the card's. */
function gridCells() {
  const grid = screen.getAllByRole('article')[0].parentElement as HTMLElement;
  return Array.from(grid.children).map(
    (cell) => cell.getAttribute('aria-label') ?? cell.textContent
  );
}

/** The grid's tile by its name, if the grid has one. */
const tile = (name: string) => {
  const grid = screen.getAllByRole('article')[0].parentElement as HTMLElement;
  return within(grid)
    .queryAllByRole('button', { name })
    .find((b) => b.parentElement === grid);
};

const chip = (label: string) =>
  screen.getByRole('radio', { name: new RegExp(`^${label}\\s*\\d+$`) });

describe('the add tile', () => {
  it('starts an owner’s grid with Add item, which opens the add dialog', async () => {
    const user = userEvent.setup();
    await open();

    expect(gridCells()[0]).toBe('Add item');
    expect(gridCells().slice(1)).toEqual(['Item: Vase', 'Item: Lamp']);
    expect(tile('Propose an item')).toBeUndefined();

    await user.click(tile('Add item')!);
    expect(await screen.findByRole('dialog', { name: 'Add new item' })).toBeInTheDocument();
  });

  it('starts a member’s grid with Propose an item, which opens the propose dialog', async () => {
    userRole = 'member';
    const user = userEvent.setup();
    await open();

    expect(gridCells()[0]).toBe('Propose an item');
    expect(tile('Add item')).toBeUndefined();

    await user.click(tile('Propose an item')!);
    expect(await screen.findByRole('dialog', { name: 'Propose new item' })).toBeInTheDocument();
  });

  it('gives a visitor no tile', async () => {
    userRole = null;
    await open();

    expect(gridCells()).toEqual(['Item: Lamp']);
    expect(screen.queryByRole('button', { name: 'Add item' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Propose/ })).toBeNull();
  });

  it('gives a signed-out visitor no tile', async () => {
    userRole = null;
    auth.session = { data: null, status: 'unauthenticated' };
    await open();

    expect(gridCells()).toEqual(['Item: Lamp']);
  });

  it('steps aside under an owner’s other chips, where the new item may not be listed', async () => {
    const user = userEvent.setup();
    await open();

    await user.click(chip('Drafts'));
    expect(gridCells()).toEqual(['Item: Vase']);
    await user.click(chip('Live'));
    expect(gridCells()).toEqual(['Item: Lamp']);
    await user.click(chip('All'));
    expect(gridCells()[0]).toBe('Add item');
  });

  it('stays under a member’s Your proposals, and steps aside under Available', async () => {
    userRole = 'member';
    listItems = [item('Lamp'), item('Kite', { status: 'proposed', proposedBy: 'carol' }, 2)];
    const user = userEvent.setup();
    await open();

    await user.click(chip('Your proposals'));
    expect(gridCells()).toEqual(['Propose an item', 'Item: Kite']);
    await user.click(chip('Available'));
    expect(gridCells()).toEqual(['Item: Lamp']);
  });

  it('offers Propose an item under a member’s Your proposals before they have any', async () => {
    userRole = 'member';
    const user = userEvent.setup();
    await open();

    await user.click(chip('Your proposals'));
    const empty = screen.getByRole('heading', { name: 'No items found' })
      .parentElement as HTMLElement;
    await user.click(within(empty).getByRole('button', { name: 'Propose an item' }));
    expect(await screen.findByRole('dialog', { name: 'Propose new item' })).toBeInTheDocument();
  });

  it('steps aside while a search narrows the grid', async () => {
    const user = userEvent.setup();
    await open();

    await user.type(screen.getByRole('textbox', { name: 'Search items by name' }), 'lamp');
    await waitFor(() => expect(gridCells()).toEqual(['Item: Lamp']));
    await user.clear(screen.getByRole('textbox', { name: 'Search items by name' }));
    await waitFor(() => expect(gridCells()[0]).toBe('Add item'));
  });

  it('is not on an empty list, whose empty state offers the add itself', async () => {
    listItems = [];
    await open();

    expect(screen.getByRole('heading', { name: 'Your list is empty' })).toBeInTheDocument();
    // Only the header's.
    expect(screen.getAllByRole('button', { name: 'Add item' })).toHaveLength(1);
  });

  it('is not shown when the items could not be read', async () => {
    itemsFail = true;
    await open();

    expect(screen.getByRole('heading', { name: 'Couldn’t load this list’s items' })).toBeVisible();
    expect(screen.getAllByRole('button', { name: 'Add item' })).toHaveLength(1);
  });
});

describe('Keep adding, from the tile', () => {
  it('adds two items through the page, each confirmed, without closing the dialog', async () => {
    const user = userEvent.setup();
    await open();

    await user.click(tile('Add item')!);
    const dialog = await screen.findByRole('dialog', { name: 'Add new item' });
    await user.click(within(dialog).getByRole('checkbox', { name: 'Keep adding' }));

    for (const name of ['Bike', 'Helmet']) {
      await user.type(within(dialog).getByLabelText(/item name/i), name);
      await user.click(within(dialog).getByRole('button', { name: 'Add to list' }));
      await screen.findByRole('article', { name: `Item: ${name}` });
      await waitFor(() => expect(within(dialog).getByLabelText(/item name/i)).toHaveValue(''));
    }

    expect(screen.getByRole('dialog', { name: 'Add new item' })).toBe(dialog);
    expect(showToast.mock.calls).toEqual([
      ['Item added successfully', 'success'],
      ['Item added successfully', 'success'],
    ]);
    // The tile stays first; the draft, then the live items, newest first.
    expect(gridCells()).toEqual([
      'Add item',
      'Item: Vase',
      'Item: Helmet',
      'Item: Bike',
      'Item: Lamp',
    ]);
  });
});
