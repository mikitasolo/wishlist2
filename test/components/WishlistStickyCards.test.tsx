// @vitest-environment jsdom
// A card the viewer just changed stays where it is, and in view, until they
// change the chip, the search or the sort (WIS-297): reserving on Available,
// publishing on Drafts or marking as received on Live no longer makes the card
// vanish or jump mid-tap, and a failed request doesn't flicker it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ApiItem } from '@/types/api';

const { router, showToast, params } = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
  showToast: vi.fn(),
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
vi.mock('@/components/AppHeader', () => ({ default: () => null }));
vi.mock('@/components/AuthButton', () => ({ default: () => null }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));

import WishlistDetail from '@/app/wishlists/[id]/page';

let userRole: 'owner' | 'member';
// The items as the server holds them, each read and write going to it.
let serverItems: ApiItem[];
// When set, every PATCH waits for it, then fails.
let failGate: Promise<void> | null;

const reply = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
});

function item(name: string, fields: Partial<ApiItem>, day: number): ApiItem {
  const at = `2026-01-${String(day).padStart(2, '0')}T00:00:00.000Z`;
  return {
    _id: `i-${name}`,
    wishlist: 'w-birthday',
    name,
    status: 'available',
    createdAt: at,
    updatedAt: at,
    ...fields,
  } as ApiItem;
}

/** What the items API gives Carol: an owner never gets a booking. */
const readItems = () =>
  serverItems.map((i) =>
    userRole === 'owner' && i.status === 'booked'
      ? { ...i, status: 'available', bookedBy: null }
      : i
  );

const fetchMock = vi.fn();

beforeEach(() => {
  localStorage.clear();
  params.id = 'birthday';
  window.history.replaceState(null, '', '/wishlists/birthday');
  failGate = null;
  userRole = 'member';
  serverItems = [
    item('Lamp', {}, 1),
    item('Kettle', { status: 'booked', bookedBy: 'dave' }, 2),
    item('Mug', {}, 3),
    item('Sketch', { status: 'draft' }, 4),
  ];
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const patch = /^\/api\/items\/([^/]+)$/.exec(url);
    if (patch && method === 'PATCH') {
      if (failGate) {
        await failGate;
        return reply({ success: false, error: 'Something went wrong' }, 500);
      }
      const updates = JSON.parse(String(init?.body)) as Partial<ApiItem>;
      serverItems = serverItems.map((i) =>
        i._id === patch[1]
          ? {
              ...i,
              ...updates,
              bookedBy: updates.status === 'booked' ? 'carol' : updates.status ? null : i.bookedBy,
            }
          : i
      );
      return reply({ success: true, data: readItems().find((i) => i._id === patch[1]) });
    }
    if (url === '/api/wishlists/birthday/items' && method === 'GET') {
      return reply({
        success: true,
        data: readItems().filter((i) => userRole === 'owner' || i.status !== 'draft'),
      });
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
const card = (name: string) => screen.getByRole('article', { name: `Item: ${name}` });
const chip = (label: string) =>
  screen.getByRole('radio', { name: new RegExp(`^${label}\\s*\\d+$`) });

async function open() {
  render(<WishlistDetail />);
  await screen.findByRole('heading', { level: 1, name: 'Birthday' });
  await waitFor(() => expect(screen.queryAllByRole('article').length).toBeGreaterThan(0));
}

describe('a member', () => {
  // regression: the chip filtered the grid as soon as the viewer's own reserve
  // changed the item's status, so the card (and its Release) vanished mid-tap.
  it('regression: keeps a card they reserve on Available in view, with its Release, until they change the chip', async () => {
    await open();
    const user = userEvent.setup();
    await user.click(chip('Available'));
    expect(shown()).toEqual(['Mug', 'Lamp']);

    await user.click(within(card('Mug')).getByRole('button', { name: 'Reserve this item' }));
    await waitFor(() =>
      expect(within(card('Mug')).getByRole('button', { name: 'Release this item' })).toBeEnabled()
    );
    expect(shown()).toEqual(['Mug', 'Lamp']);
    // The counts are the truth, whatever stays in view.
    expect(chip('Available')).toHaveAccessibleName(/Available\s*1/);

    // Touching the filter lets it go: back on Available, Mug is gone.
    await user.click(chip('All'));
    await user.click(chip('Available'));
    expect(shown()).toEqual(['Lamp']);
  });

  it('keeps a card they reserve under All in its slot instead of moving it to the reserved group, until they change the sort', async () => {
    await open();
    expect(shown()).toEqual(['Mug', 'Lamp', 'Kettle']);
    const user = userEvent.setup();
    await user.click(within(card('Mug')).getByRole('button', { name: 'Reserve this item' }));
    await waitFor(() =>
      expect(within(card('Mug')).getByRole('button', { name: 'Release this item' })).toBeEnabled()
    );
    expect(shown()).toEqual(['Mug', 'Lamp', 'Kettle']);

    // A new search lets it go to its group.
    await user.type(screen.getByLabelText('Search items by name'), 'm');
    await user.clear(screen.getByLabelText('Search items by name'));
    expect(shown()).toEqual(['Lamp', 'Mug', 'Kettle']);
  });

  it('leaves a card whose reserve failed where it was, with no flicker', async () => {
    await open();
    const user = userEvent.setup();
    await user.click(chip('Available'));
    let fail!: () => void;
    failGate = new Promise((resolve) => (fail = resolve));

    await user.click(within(card('Mug')).getByRole('button', { name: 'Reserve this item' }));
    // In flight: optimistically reserved, still in view and in its slot.
    expect(shown()).toEqual(['Mug', 'Lamp']);
    fail();
    await waitFor(() =>
      expect(within(card('Mug')).getByRole('button', { name: 'Reserve this item' })).toBeEnabled()
    );
    expect(shown()).toEqual(['Mug', 'Lamp']);
    expect(showToast).toHaveBeenCalledWith('Something went wrong', 'error');
  });
});

describe('an owner', () => {
  beforeEach(() => {
    userRole = 'owner';
  });

  it('keeps a draft they publish on Drafts in view until they change the chip', async () => {
    await open();
    const user = userEvent.setup();
    await user.click(chip('Drafts'));
    expect(shown()).toEqual(['Sketch']);
    await user.click(within(card('Sketch')).getByRole('button', { name: 'Publish item' }));
    await waitFor(() =>
      expect(within(card('Sketch')).queryByRole('button', { name: 'Publish item' })).toBeNull()
    );
    expect(shown()).toEqual(['Sketch']);
    await user.click(chip('Live'));
    await user.click(chip('Drafts'));
    expect(screen.queryAllByRole('article')).toEqual([]);
  });

  it('pins nothing for a content edit: Most wanted moves the card by the sort, as before', async () => {
    await open();
    const user = userEvent.setup();
    await user.click(chip('Live'));
    const last = shown().at(-1)!;
    await user.click(within(card(last)).getByRole('button', { name: 'More actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Mark as most wanted' }));
    await waitFor(() => expect(shown()[0]).toBe(last));
  });

  // regression: pinning only keeps a card in view: its badge is its own status
  // as the owner reads it, never a booking.
  it('regression: keeps a card they mark as received on Live in its slot, showing Received and nothing of a booking', async () => {
    await open();
    const user = userEvent.setup();
    await user.click(chip('Live'));
    const before = shown();
    expect(before).toEqual(expect.arrayContaining(['Kettle', 'Lamp', 'Mug']));

    await user.click(within(card('Kettle')).getByRole('button', { name: 'More actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Mark as received' }));
    await user.click(screen.getByRole('button', { name: 'Mark as received' }));
    await waitFor(() => expect(within(card('Kettle')).getByText('Received')).toBeInTheDocument());
    expect(shown()).toEqual(before);
    expect(within(card('Kettle')).queryByText(/Reserved/)).toBeNull();
  });
});
