// @vitest-environment jsdom
// What the wishlist page shows when there's nothing to show: a list with no
// items at all says so, with each role's way forward and without the stat
// cards and the toolbar, and a list whose items the search or status filter
// hides says that, with a way back to all of them.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ApiItem } from '@/types/api';

const { router, showToast, auth } = vi.hoisted(() => ({
  // One object, as Next's own router is: the page's read of the list depends on it.
  router: { push: vi.fn(), replace: vi.fn() },
  showToast: vi.fn(),
  // Who is signed in, if anyone; a test signs Carol out.
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

import WishlistDetail from '@/app/wishlists/[id]/page';

// What Carol is on the list (null: a visitor), and its items as the items API
// gives them to her. `itemsFail` makes every read of the items fail.
let userRole: 'owner' | 'member' | null;
let listItems: ApiItem[];
let itemsFail: boolean;
let archived: boolean;

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

// jsdom has no scrollTo, which a dialog's scroll lock puts the page back with on close.
beforeAll(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterAll(() => vi.restoreAllMocks());

beforeEach(() => {
  localStorage.clear();
  auth.session = {
    data: { user: { id: 'carol', username: 'carol' } },
    status: 'authenticated',
  };
  userRole = 'owner';
  listItems = [];
  itemsFail = false;
  archived = false;
  showToast.mockReset();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url === '/api/wishlists/birthday/items') {
      if (method === 'POST') {
        const body = JSON.parse(String(init?.body));
        const created = item(body.name, { status: body.status ?? 'available' }, 9);
        listItems = [created, ...listItems];
        return reply({ success: true, data: created }, 201);
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
          archived,
          featured: false,
          currency: 'EUR',
          bannerUrl: null,
          occasion: null,
        },
      });
    }
    // Members, invites, rates.
    if (method === 'GET') return reply({ success: true, data: [] });
    return reply({ success: false, error: 'Not mocked' }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The names of the item cards shown, in order. */
const shown = () =>
  screen.queryAllByRole('article').map((a) => a.getAttribute('aria-label')?.replace('Item: ', ''));

/** Whether the items have been read: the cards, or any of the page's answers for none. */
const ANSWERS =
  /^(Your list is empty|Nothing here yet|No items yet|No items found|Failed to load items)$/;

/** Open the list and wait for its first read of the items to land. */
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

/** The empty state's box, found by its heading. */
const emptyState = (heading: string) =>
  screen.getByRole('heading', { name: heading }).parentElement as HTMLElement;

/**
 * None of the stat cards, nothing in the toolbar, and not the + Add Item or
 * + Propose Item above the list (the empty state offers its own), is on the page.
 */
function expectNoCardsOrToolbar() {
  expect(screen.queryByRole('button', { name: /^(Total Items|All)\s*\d+$/ })).toBeNull();
  expect(screen.queryByRole('button', { name: /^Available\s*\d+$/ })).toBeNull();
  expect(screen.queryByRole('textbox', { name: 'Search items by name' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Filter by status' })).toBeNull();
  expect(screen.queryByRole('combobox', { name: 'Sort items by' })).toBeNull();
  expect(screen.queryByRole('combobox', { name: 'Show prices in' })).toBeNull();
  expect(screen.queryByRole('button', { name: '+ Add Item' })).toBeNull();
  expect(screen.queryByRole('button', { name: '+ Propose Item' })).toBeNull();
}

/** Owner Carol adds an item through the empty state's Add your first item. */
async function addFirstItem(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('button', { name: 'Add your first item' }));
  const dialog = await screen.findByRole('dialog', { name: 'Add New Item' });
  await user.type(within(dialog).getByLabelText(/Item Name/), name);
  await user.click(within(dialog).getByRole('button', { name: 'Add Item' }));
}

describe('a list with no items at all', () => {
  // regression: the owner's default filter never includes All, so a new list
  // said "No items match the selected filters", under five zero cards and the
  // toolbar, and offered no way to add an item.
  it('regression: tells the owner their list is empty and offers Add your first item and Share, with no cards or toolbar', async () => {
    const user = userEvent.setup();
    await open();

    const box = emptyState('Your list is empty');
    expect(box).toHaveTextContent(
      "Add the things you'd love to get. You can keep them as drafts until you're ready to share."
    );
    expect(screen.queryByText(/match the selected filters/)).toBeNull();
    expect(screen.queryByRole('heading', { name: 'No items found' })).toBeNull();
    expectNoCardsOrToolbar();

    // Share copies the list's link.
    await user.click(within(box).getByRole('button', { name: 'Copy link to share' }));
    expect(await navigator.clipboard.readText()).toBe(window.location.href);
    expect(showToast).toHaveBeenCalledWith('Link copied to clipboard', 'success');

    await user.click(within(box).getByRole('button', { name: 'Add your first item' }));
    expect(await screen.findByRole('dialog', { name: 'Add New Item' })).toBeInTheDocument();
  });

  // regression: the empty state's Share showed on an archived list, whose link
  // opens for its owners only, though the header leaves its Share out there.
  it('regression: offers no Share on an archived list, only Add your first item', async () => {
    archived = true;
    await open();

    const box = emptyState('Your list is empty');
    expect(within(box).getByRole('button', { name: 'Add your first item' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy link to share' })).toBeNull();
  });

  it('regression: tells a member there is nothing here yet and offers Propose an item, with no cards or toolbar', async () => {
    userRole = 'member';
    const user = userEvent.setup();
    await open();

    const box = emptyState('Nothing here yet');
    expect(screen.queryByText(/match the selected filters/)).toBeNull();
    expect(within(box).queryByRole('button', { name: 'Add your first item' })).toBeNull();
    expect(within(box).queryByRole('button', { name: 'Copy link to share' })).toBeNull();
    expectNoCardsOrToolbar();

    await user.click(within(box).getByRole('button', { name: 'Propose an item' }));
    expect(await screen.findByRole('dialog', { name: 'Propose New Item' })).toBeInTheDocument();
  });

  it.each([
    ['signed in', true],
    ['signed out', false],
  ])(
    'regression: tells a visitor (%s) there are no items yet, with no action, cards or toolbar',
    async (_who, signedIn) => {
      userRole = null;
      if (!signedIn) auth.session = { data: null, status: 'unauthenticated' };
      await open();

      const box = emptyState('No items yet');
      expect(within(box).queryByRole('button')).toBeNull();
      expect(screen.queryByText(/match the selected filters/)).toBeNull();
      expect(screen.queryByRole('button', { name: /Add|Propose/ })).toBeNull();
      expectNoCardsOrToolbar();
    }
  );

  it("brings the cards and the toolbar back once the owner's first item is added", async () => {
    const user = userEvent.setup();
    await open();

    await addFirstItem(user, 'Lamp');

    await waitFor(() => expect(shown()).toEqual(['Lamp']));
    expect(screen.queryByRole('heading', { name: 'Your list is empty' })).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Search items by name' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filter by status' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Add Item' })).toBeInTheDocument();
  });

  // The toolbar goes with the last item, so a filter or search left in force
  // couldn't be seen, and would hide the next item added.
  it('puts the filter and the search back to the defaults when the list empties', async () => {
    listItems = [item('Vase', { status: 'completed' }, 1)];
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole('button', { name: /^Completed\s*\d+$/ }));
    await user.type(screen.getByRole('textbox', { name: 'Search items by name' }), 'vase');
    expect(shown()).toEqual(['Vase']);

    // A co-owner deletes it, and the next poll finds the list empty.
    listItems = [];
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    visibility.mockRestore();
    await screen.findByRole('heading', { name: 'Your list is empty' });

    await addFirstItem(user, 'Lamp');

    await waitFor(() => expect(shown()).toEqual(['Lamp']));
    expect(screen.getByRole('textbox', { name: 'Search items by name' })).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Filter by status' })).toHaveTextContent(
      '3 selected'
    );
  });

  // The list couldn't be read, which says nothing about whether it's empty.
  it("doesn't call a list empty when its items couldn't be loaded", async () => {
    itemsFail = true;
    await open();

    expect(screen.getByRole('heading', { name: 'Failed to load items' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Your list is empty' })).toBeNull();
    expect(showToast).toHaveBeenCalledWith('Failed to load items', 'error');
  });
});

describe('a list whose items are all filtered out', () => {
  // regression: the status filter could hide every item with no way back but
  // the filter itself; an owner whose items are all completed met that on the
  // defaults, before touching a filter.
  it("regression: says no items match the selected filters, and Show all shows the owner's every item", async () => {
    listItems = [
      item('Vase', { status: 'completed' }, 1),
      item('Clock', { status: 'completed' }, 2),
    ];
    const user = userEvent.setup();
    await open();

    expect(shown()).toEqual([]);
    expect(screen.getByRole('heading', { name: 'No items found' })).toBeInTheDocument();
    expect(screen.getByText('No items match the selected filters.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Your list is empty' })).toBeNull();
    // The cards and the toolbar are there to change it.
    expect(screen.getByRole('button', { name: 'Filter by status' })).toHaveTextContent(
      '3 selected'
    );

    await user.click(screen.getByRole('button', { name: 'Show all' }));

    expect(shown()).toEqual(['Clock', 'Vase']);
    expect(screen.getByRole('button', { name: 'Filter by status' })).toHaveTextContent('All');
    expect(screen.queryByRole('heading', { name: 'No items found' })).toBeNull();
  });

  it("regression: offers Show all when a member's stat card hides every item", async () => {
    userRole = 'member';
    listItems = [item('Lamp', {}, 1), item('Scarf', { status: 'booked', bookedBy: 'carol' }, 2)];
    const user = userEvent.setup();
    await open();
    expect(shown()).toEqual(['Scarf', 'Lamp']);

    await user.click(screen.getByRole('button', { name: /^Booked by Others\s*0$/ }));
    expect(shown()).toEqual([]);
    expect(screen.getByText('No items match the selected filters.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Nothing here yet' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Show all' }));
    expect(shown()).toEqual(['Scarf', 'Lamp']);
  });

  it('says what the search matched nothing for, and Show all clears it', async () => {
    listItems = [item('Lamp', {}, 1), item('Vase', { status: 'completed' }, 2)];
    const user = userEvent.setup();
    await open();

    await user.type(screen.getByRole('textbox', { name: 'Search items by name' }), 'bike');
    expect(shown()).toEqual([]);
    expect(screen.getByText('No items match “bike”.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show all' }));
    expect(screen.getByRole('textbox', { name: 'Search items by name' })).toHaveValue('');
    expect(shown()).toEqual(['Vase', 'Lamp']);
  });
});
