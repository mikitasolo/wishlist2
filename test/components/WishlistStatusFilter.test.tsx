// @vitest-environment jsdom
// The wishlist page's status filter (the stat cards and the Status dropdown):
// it starts on the viewer's role's defaults on every list, and never holds an
// empty selection. The sort, a preference, is still remembered.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ApiItem } from '@/types/api';
import { WISHLIST_SORT_STORAGE_KEY } from '@/lib/utils/itemFilters';

const { router, showToast, params } = vi.hoisted(() => ({
  // One object, as Next's own router is: the page's read of the list depends on it.
  router: { push: vi.fn(), replace: vi.fn() },
  showToast: vi.fn(),
  // The list being opened; a test changes it to open another one.
  params: { id: 'birthday' },
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { user: { id: 'carol', username: 'carol' } },
    status: 'authenticated',
  }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  useParams: () => params,
}));

// The header has its own fetches and tests; this file is about the filter.
vi.mock('@/components/AppHeader', () => ({ default: () => null }));
vi.mock('@/components/AuthButton', () => ({ default: () => null }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));

import WishlistDetail from '@/app/wishlists/[id]/page';

// Carol is signed in. What she is on every list, for this test.
let userRole: 'owner' | 'member';

const reply = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
});

function item(list: string, name: string, fields: Partial<ApiItem>, day: number): ApiItem {
  return {
    _id: `${list}-${name}`,
    wishlist: list,
    name,
    status: 'available',
    createdAt: `2026-01-${String(day).padStart(2, '0')}T00:00:00.000Z`,
    updatedAt: `2026-01-${String(day).padStart(2, '0')}T00:00:00.000Z`,
    ...fields,
  } as ApiItem;
}

/** A list's items as the items API gives them to Carol in her role. */
function itemsOf(list: string): ApiItem[] {
  if (userRole === 'owner') {
    // Owners never see booking: a booked item comes back available.
    return [
      item(list, 'Lamp', {}, 1),
      item(list, 'Sketch', { status: 'draft' }, 2),
      item(list, 'Idea', { status: 'proposed' }, 3),
      item(list, 'Vase', { status: 'completed' }, 4),
    ];
  }
  return [
    item(list, 'Lamp', {}, 1),
    item(list, 'Scarf', { status: 'booked', bookedBy: 'carol' }, 2),
    item(list, 'Kettle', { status: 'booked', bookedBy: 'dave' }, 3),
    item(list, 'Vase', { status: 'completed' }, 4),
    item(list, 'Idea', { status: 'proposed', proposedBy: 'carol' }, 5),
  ];
}

const fetchMock = vi.fn();

beforeEach(() => {
  localStorage.clear();
  params.id = 'birthday';
  userRole = 'member';
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const list = /^\/api\/wishlists\/([^/]+)(\/items)?$/.exec(url);
    if (list && method === 'GET') {
      const [, id, items] = list;
      if (items) return reply({ success: true, data: itemsOf(id) });
      return reply({
        success: true,
        data: {
          _id: `w-${id}`,
          name: id === 'birthday' ? 'Birthday' : 'Christmas',
          slug: id,
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

const statusDropdown = () => screen.getByRole('button', { name: 'Filter by status' });
/** A stat card, by its label (its accessible name is the label and the count). */
const card = (label: string) =>
  screen.getByRole('button', { name: new RegExp(`^${label}\\s*\\d+$`) });

/** Open a list (as Next does, on a page of its own) and wait for its items. */
async function open(id: string) {
  params.id = id;
  const view = render(<WishlistDetail />);
  await screen.findByRole('heading', {
    level: 1,
    name: id === 'birthday' ? 'Birthday' : 'Christmas',
  });
  await waitFor(() => expect(screen.queryAllByRole('article').length).toBeGreaterThan(0));
  return view;
}

/** Tick or untick one option in the Status dropdown. */
async function toggleStatus(user: ReturnType<typeof userEvent.setup>, option: string) {
  if (!screen.queryByRole('checkbox', { name: 'All' })) await user.click(statusDropdown());
  await user.click(screen.getByRole('checkbox', { name: option }));
}

// Newest first, the default sort.
const MEMBER_DEFAULTS = ['Idea', 'Scarf', 'Lamp'];
const OWNER_DEFAULTS = ['Idea', 'Sketch', 'Lamp'];

describe('the status filter is not carried from one list to another', () => {
  it.each([
    [
      'a stat card',
      async (user: ReturnType<typeof userEvent.setup>) => {
        await user.click(card('Booked by Others'));
      },
    ],
    [
      'the Status dropdown',
      async (user: ReturnType<typeof userEvent.setup>) => {
        await toggleStatus(user, 'Booked by Others');
        await toggleStatus(user, 'Available');
        await toggleStatus(user, 'Booked by You');
        await toggleStatus(user, 'Proposed by You');
      },
    ],
  ])(
    // regression: the filter was saved per role (wishlist-filters-member), so
    // "Booked by Others" picked on one list opened every other list showing
    // only booked items, as if there were nothing left to buy.
    'regression: a filter picked with %s on one list leaves the next list on the defaults',
    async (_how, pick) => {
      const user = userEvent.setup();
      const first = await open('birthday');
      expect(shown()).toEqual(MEMBER_DEFAULTS);

      await pick(user);
      expect(shown()).toEqual(['Kettle']);
      expect(statusDropdown()).toHaveTextContent('Booked by Others');

      first.unmount();
      await open('christmas');

      expect(shown()).toEqual(MEMBER_DEFAULTS);
      expect(statusDropdown()).toHaveTextContent('3 selected');
      expect(card('Booked by Others')).toHaveAttribute('aria-pressed', 'false');
      expect(localStorage.length).toBe(0);
    }
  );

  // Next mounts each list's page on its own, but the filter is kept with the
  // list it was picked for, so it doesn't rely on that.
  it('regression: puts the filter back to the defaults even when the page is reused for another list', async () => {
    const user = userEvent.setup();
    const view = await open('birthday');
    await user.click(card('Booked by Others'));
    expect(shown()).toEqual(['Kettle']);

    params.id = 'christmas';
    view.rerender(<WishlistDetail />);
    await screen.findByRole('heading', { level: 1, name: 'Christmas' });

    await waitFor(() => expect(statusDropdown()).toHaveTextContent('3 selected'));
    expect(shown()).toEqual(MEMBER_DEFAULTS);
  });

  it("regression: puts an owner's next list back on the owner's defaults, with no booking filter", async () => {
    userRole = 'owner';
    const user = userEvent.setup();
    const first = await open('birthday');
    expect(shown()).toEqual(OWNER_DEFAULTS);

    await user.click(card('Completed'));
    expect(shown()).toEqual(['Vase']);

    first.unmount();
    await open('christmas');

    expect(shown()).toEqual(OWNER_DEFAULTS);
    expect(screen.queryByRole('button', { name: /^Booked/ })).toBeNull();
    await user.click(statusDropdown());
    expect(screen.queryByRole('checkbox', { name: /Booked/ })).toBeNull();
  });

  // regression: a value an earlier version saved must not come back.
  it('regression: ignores and deletes a status filter an earlier version saved', async () => {
    localStorage.setItem('wishlist-filters-member', JSON.stringify(['bookedByOthers']));
    localStorage.setItem('wishlist-filters-owner', JSON.stringify(['completed']));
    localStorage.setItem('wishlist-filters-nonmember', JSON.stringify(['completed']));

    await open('birthday');

    expect(shown()).toEqual(MEMBER_DEFAULTS);
    expect(localStorage.getItem('wishlist-filters-member')).toBeNull();
    expect(localStorage.getItem('wishlist-filters-owner')).toBeNull();
    expect(localStorage.getItem('wishlist-filters-nonmember')).toBeNull();
  });
});

describe('the sort is still remembered', () => {
  it('opens the next list on the sort picked on the last one', async () => {
    const user = userEvent.setup();
    const first = await open('birthday');

    await user.click(screen.getByRole('combobox', { name: 'Sort items by' }));
    await user.click(screen.getByRole('option', { name: 'Name (Z-A)' }));
    expect(shown()).toEqual(['Scarf', 'Lamp', 'Idea']);

    first.unmount();
    await open('christmas');

    expect(screen.getByRole('combobox', { name: 'Sort items by' })).toHaveTextContent('Name (Z-A)');
    expect(shown()).toEqual(['Scarf', 'Lamp', 'Idea']);
    expect(localStorage.getItem(WISHLIST_SORT_STORAGE_KEY)).toBe('name-desc');
  });
});

describe('the status filter is never empty', () => {
  // regression: unticking All left nothing selected; the dropdown said "None
  // selected" while the list showed every item.
  it('regression: goes back to the defaults when All is unticked', async () => {
    const user = userEvent.setup();
    await open('birthday');
    await toggleStatus(user, 'All');
    expect(shown()).toHaveLength(5);
    expect(statusDropdown()).toHaveTextContent('All');

    await toggleStatus(user, 'All');

    expect(shown()).toEqual(MEMBER_DEFAULTS);
    expect(statusDropdown()).toHaveTextContent('3 selected');
    expect(screen.getByRole('checkbox', { name: 'All' })).not.toBeChecked();
    expect(screen.queryByText('None selected')).toBeNull();
  });

  it('regression: goes back to the defaults when the last option ticked is unticked', async () => {
    const user = userEvent.setup();
    await open('birthday');
    await user.click(card('Booked by Others'));
    expect(shown()).toEqual(['Kettle']);

    await toggleStatus(user, 'Booked by Others');

    expect(shown()).toEqual(MEMBER_DEFAULTS);
    expect(statusDropdown()).toHaveTextContent('3 selected');
    expect(screen.getByRole('checkbox', { name: 'Booked by Others' })).not.toBeChecked();
    expect(screen.queryByText('None selected')).toBeNull();
  });
});
