// @vitest-environment jsdom
// The wishlist page's status chips (D7): one single-select row with counts,
// which starts on All on every list and is never saved (only the URL's ?show=
// keeps it), with the actionable items first under All. The sort, a
// preference, is still remembered.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';
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
    data: { user: { id: 'carol', username: 'carol', defaultCurrency: 'EUR' } },
    status: 'authenticated',
  }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  useParams: () => params,
}));

// The header has its own fetches and tests; this file is about the chips.
vi.mock('@/components/AppHeader', () => ({ default: () => null }));
vi.mock('@/components/AuthButton', () => ({ default: () => null }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));

import WishlistDetail from '@/app/wishlists/[id]/page';

// Carol is signed in. What she is on every list, for this test.
let userRole: 'owner' | 'member' | null;

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
    return [
      item(list, 'Lamp', {}, 1),
      item(list, 'Sketch', { status: 'draft' }, 2),
      item(list, 'Idea', { status: 'proposed' }, 3),
      item(list, 'Vase', { status: 'completed' }, 4),
      // The API sends an owner a booked item as available; one that came
      // through booked must still count as Live, never as reserved.
      item(list, 'Kettle', { status: 'booked' }, 5),
    ];
  }
  if (userRole === null) {
    return [item(list, 'Lamp', {}, 1), item(list, 'Vase', { status: 'completed' }, 2)];
  }
  return [
    item(list, 'Lamp', {}, 1),
    item(list, 'Scarf', { status: 'booked', bookedBy: 'carol' }, 2),
    item(list, 'Kettle', { status: 'booked' }, 3),
    item(list, 'Vase', { status: 'completed' }, 4),
    item(list, 'Idea', { status: 'proposed', proposedBy: 'carol' }, 5),
    item(list, 'Mug', {}, 6),
  ];
}

const fetchMock = vi.fn();
// Holds the read of the christmas list until a test lets it through.
let christmasGate: Promise<void> | null;

beforeEach(() => {
  localStorage.clear();
  params.id = 'birthday';
  window.history.replaceState(null, '', '/wishlists/birthday');
  userRole = 'member';
  christmasGate = null;
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const list = /^\/api\/wishlists\/([^/]+)(\/items)?$/.exec(url);
    if (list && method === 'GET') {
      const [, id, items] = list;
      if (items) return reply({ success: true, data: itemsOf(id) });
      if (id === 'christmas' && christmasGate) await christmasGate;
      // `birthday-2`: the birthday list, once an owner has given it that slug.
      const renamed = id === 'birthday-2';
      return reply({
        success: true,
        data: {
          _id: renamed ? 'w-birthday' : `w-${id}`,
          name: id.startsWith('birthday') ? 'Birthday' : 'Christmas',
          slug: id,
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

/** The names of the cards shown dimmed. */
const dimmed = () =>
  screen
    .queryAllByRole('article')
    .filter((a) => a.hasAttribute('data-dimmed'))
    .map((a) => a.getAttribute('aria-label')?.replace('Item: ', ''));

/** A chip, by its label (its accessible name is the label and the count). */
const chip = (label: string) =>
  screen.getByRole('radio', { name: new RegExp(`^${label}\\s*\\d+$`) });

/** Each chip's accessible name, in order. */
const chipNames = () =>
  screen.queryAllByRole('radio').map((r) => r.textContent?.replace(/\s+/g, ' ').trim());

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

// Under All, a member's groups: available (newest first, the default sort),
// reserved by you, their own proposal, reserved by someone else, received.
const MEMBER_ALL = ['Mug', 'Lamp', 'Scarf', 'Idea', 'Kettle', 'Vase'];
// An owner's: proposals, drafts, live (a booked item included), received.
const OWNER_ALL = ['Idea', 'Sketch', 'Kettle', 'Lamp', 'Vase'];

describe('the chips each role gets', () => {
  it("gives a member All, Available, Reserved by you and Your proposals, with each one's count", async () => {
    await open('birthday');
    expect(screen.getByRole('radiogroup', { name: 'Show items' })).toBeInTheDocument();
    expect(chipNames()).toEqual(['All 6', 'Available 2', 'Reserved by you 1', 'Your proposals 1']);
    expect(chip('All')).toBeChecked();
  });

  // regression: an owner never sees booking, so a booked item counts under Live.
  it('regression: gives an owner Drafts, Proposals, Live and Received, a booked item counted as Live', async () => {
    userRole = 'owner';
    await open('birthday');
    expect(chipNames()).toEqual(['All 5', 'Drafts 1', 'Proposals 1', 'Live 2', 'Received 1']);
    expect(screen.queryByRole('radio', { name: /Reserv|Book/i })).toBeNull();

    const user = userEvent.setup();
    await user.click(chip('Live'));
    expect(shown()).toEqual(['Kettle', 'Lamp']);
  });

  it('gives a visitor no chips, and every item, received last and dimmed', async () => {
    userRole = null;
    await open('birthday');
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(shown()).toEqual(['Lamp', 'Vase']);
    expect(dimmed()).toEqual(['Vase']);
  });
});

describe('All, the chip every list opens on', () => {
  it("puts a member's actionable items first, and dims what someone else reserved and what's received", async () => {
    await open('birthday');
    expect(shown()).toEqual(MEMBER_ALL);
    expect(dimmed()).toEqual(['Kettle', 'Vase']);
  });

  it("puts an owner's proposals, then drafts, then live items, then received ones (dimmed)", async () => {
    userRole = 'owner';
    await open('birthday');
    expect(shown()).toEqual(OWNER_ALL);
    expect(dimmed()).toEqual(['Vase']);
  });

  it('narrows to one chip and back to All, and dims nothing under a chip', async () => {
    const user = userEvent.setup();
    await open('birthday');

    await user.click(chip('Available'));
    expect(chip('Available')).toBeChecked();
    expect(chip('All')).not.toBeChecked();
    expect(shown()).toEqual(['Mug', 'Lamp']);

    await user.click(chip('Reserved by you'));
    expect(shown()).toEqual(['Scarf']);
    expect(dimmed()).toEqual([]);

    await user.click(chip('All'));
    expect(shown()).toEqual(MEMBER_ALL);
  });

  it('moves between chips with the arrow keys, from one Tab stop', async () => {
    const user = userEvent.setup();
    await open('birthday');

    expect(chip('All')).toHaveAttribute('tabindex', '0');
    expect(chip('Available')).toHaveAttribute('tabindex', '-1');
    chip('All').focus();
    await user.keyboard('{ArrowRight}');
    expect(chip('Available')).toHaveFocus();
    expect(chip('Available')).toBeChecked();
    expect(shown()).toEqual(['Mug', 'Lamp']);
    await user.keyboard('{End}');
    expect(chip('Your proposals')).toBeChecked();
    await user.keyboard('{ArrowRight}');
    expect(chip('All')).toBeChecked();
  });
});

describe('a chip is not carried from one list to another', () => {
  // regression (W-2): the filter was saved per role (wishlist-filters-member),
  // so "Reserved by others" picked on one list opened every other list showing
  // only booked items, as if there were nothing left to buy.
  it('regression: a chip picked on one list leaves the next list on All', async () => {
    const user = userEvent.setup();
    const first = await open('birthday');

    await user.click(chip('Reserved by you'));
    expect(shown()).toEqual(['Scarf']);
    // Kept in the URL for back and refresh, and nowhere else.
    expect(window.location.search).toBe('?show=reserved-by-you');

    first.unmount();
    window.history.replaceState(null, '', '/wishlists/christmas');
    await open('christmas');

    expect(chip('All')).toBeChecked();
    expect(chip('Reserved by you')).not.toBeChecked();
    expect(shown()).toEqual(MEMBER_ALL);
    expect(localStorage.length).toBe(0);
  });

  // Next mounts each list's page on its own, but the chip is kept with the
  // list it was picked for, so it doesn't rely on that, nor on the URL.
  it('regression: puts the chip back on All even when the page is reused for another list', async () => {
    const user = userEvent.setup();
    const view = await open('birthday');
    await user.click(chip('Reserved by you'));
    expect(shown()).toEqual(['Scarf']);

    params.id = 'christmas';
    view.rerender(<WishlistDetail />);
    await screen.findByRole('heading', { level: 1, name: 'Christmas' });

    await waitFor(() => expect(chip('All')).toBeChecked());
    expect(shown()).toEqual(MEMBER_ALL);
  });

  it("regression: puts an owner's next list back on All, with no booking chip", async () => {
    userRole = 'owner';
    const user = userEvent.setup();
    const first = await open('birthday');

    await user.click(chip('Received'));
    expect(shown()).toEqual(['Vase']);

    first.unmount();
    window.history.replaceState(null, '', '/wishlists/christmas');
    await open('christmas');

    expect(chip('All')).toBeChecked();
    expect(shown()).toEqual(OWNER_ALL);
    expect(screen.queryByRole('radio', { name: /Booked|Reserv/i })).toBeNull();
  });

  // regression: a value an earlier version saved must not come back.
  it('regression: ignores and deletes a status filter an earlier version saved', async () => {
    localStorage.setItem('wishlist-filters-member', JSON.stringify(['bookedByOthers']));
    localStorage.setItem('wishlist-filters-owner', JSON.stringify(['completed']));
    localStorage.setItem('wishlist-filters-nonmember', JSON.stringify(['completed']));

    await open('birthday');

    expect(chip('All')).toBeChecked();
    expect(shown()).toEqual(MEMBER_ALL);
    expect(localStorage.getItem('wishlist-filters-member')).toBeNull();
    expect(localStorage.getItem('wishlist-filters-owner')).toBeNull();
    expect(localStorage.getItem('wishlist-filters-nonmember')).toBeNull();
  });
});

describe('the URL keeps the chip, for back and refresh', () => {
  it('opens on the chip the URL names', async () => {
    window.history.replaceState(null, '', '/wishlists/birthday?show=available');
    await open('birthday');
    expect(chip('Available')).toBeChecked();
    expect(shown()).toEqual(['Mug', 'Lamp']);
  });

  it("opens on All when the URL names a chip the viewer's role doesn't have", async () => {
    window.history.replaceState(null, '', '/wishlists/birthday?show=drafts');
    await open('birthday');
    expect(chip('All')).toBeChecked();
    expect(shown()).toEqual(MEMBER_ALL);
  });

  it('takes ?show= off the URL when All is picked again', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/wishlists/birthday?show=available&x=1');
    await open('birthday');
    await user.click(chip('All'));
    expect(window.location.search).toBe('?x=1');
  });

  // An owner's tabs push history entries (?tab=), so back can land on an
  // entry of this list whose URL names another chip, or none.
  it('takes the chip from the URL again on back and forward', async () => {
    const user = userEvent.setup();
    await open('birthday');
    window.history.pushState(null, '', '/wishlists/birthday?tab=people');
    window.history.pushState(null, '', '/wishlists/birthday');
    await user.click(chip('Available'));
    expect(window.location.search).toBe('?show=available');

    act(() => window.history.back());
    await waitFor(() => expect(chip('All')).toBeChecked());
    expect(window.location.search).toBe('?tab=people');
    act(() => window.history.forward());
    await waitFor(() => expect(chip('Available')).toBeChecked());
  });
});

describe('the URL keeps the chip when the list moves to a new URL', () => {
  // regression: a settings save that changes the slug moves the page to the
  // new URL with no ?show=, so a refresh lost the chip still shown as picked.
  it("regression: puts the chip back in the URL of the list's new slug", async () => {
    const user = userEvent.setup();
    const view = await open('birthday');
    await user.click(chip('Available'));
    expect(window.location.search).toBe('?show=available');

    // Next moves the page to the new URL (without ?show=) and re-reads the list.
    window.history.replaceState(null, '', '/wishlists/birthday-2');
    params.id = 'birthday-2';
    view.rerender(<WishlistDetail />);

    await waitFor(() => expect(window.location.search).toBe('?show=available'));
    expect(window.location.pathname).toBe('/wishlists/birthday-2');
    expect(chip('Available')).toBeChecked();
  });

  // While the page moves on to another list, the one on screen is still the
  // last one: its chip must not land in the next list's URL.
  it("regression: doesn't write a chip into another list's URL before that list has loaded", async () => {
    const user = userEvent.setup();
    const view = await open('birthday');
    await user.click(chip('Available'));

    let letThrough!: () => void;
    christmasGate = new Promise<void>((resolve) => (letThrough = resolve));
    window.history.replaceState(null, '', '/wishlists/christmas');
    params.id = 'christmas';
    view.rerender(<WishlistDetail />);
    // Picked while Birthday is still the list on screen.
    expect(screen.getByRole('heading', { level: 1, name: 'Birthday' })).toBeInTheDocument();
    await user.click(chip('Reserved by you'));
    expect(window.location.search).toBe('');

    await act(async () => letThrough());
    await screen.findByRole('heading', { level: 1, name: 'Christmas' });
    await waitFor(() => expect(chip('All')).toBeChecked());
    expect(window.location.search).toBe('');
  });
});

describe('the sort is still remembered', () => {
  it('opens the next list on the sort picked on the last one, applied within each group', async () => {
    const user = userEvent.setup();
    const first = await open('birthday');

    await user.click(screen.getByRole('combobox', { name: 'Sort items by' }));
    await user.click(screen.getByRole('option', { name: 'Name (A-Z)' }));
    expect(shown()).toEqual(['Lamp', 'Mug', 'Scarf', 'Idea', 'Kettle', 'Vase']);
    // The trigger's short name for it.
    expect(screen.getByRole('combobox', { name: 'Sort items by' })).toHaveTextContent('Name A–Z');

    first.unmount();
    window.history.replaceState(null, '', '/wishlists/christmas');
    await open('christmas');

    expect(screen.getByRole('combobox', { name: 'Sort items by' })).toHaveTextContent('Name A–Z');
    expect(shown()).toEqual(['Lamp', 'Mug', 'Scarf', 'Idea', 'Kettle', 'Vase']);
    expect(localStorage.getItem(WISHLIST_SORT_STORAGE_KEY)).toBe('name-asc');
  });
});
