// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { router, showToast } = vi.hoisted(() => ({
  // One object, as Next's own router is: the page's read of the list depends on it.
  router: { push: vi.fn(), replace: vi.fn() },
  showToast: vi.fn(),
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { user: { id: 'alice', username: 'alice' } },
    status: 'authenticated',
  }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  useParams: () => ({ id: 'birthday' }),
}));

// The header has its own fetches and tests; this file is about the confirmations.
vi.mock('@/components/AppHeader', () => ({ default: () => null }));
vi.mock('@/components/AuthButton', () => ({ default: () => null }));

vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));

import WishlistDetail from '@/app/wishlists/[id]/page';
import { pickLeave, openListTab, pickRowAction } from './listMenu';

// User ids double as usernames here. Alice is signed in.
let owners: string[];
let memberIds: string[];
let userRole: 'owner' | 'member';
/** The items the list's read answers with, or `null` for a read that fails. */
let items: Array<Record<string, unknown>> | null;
/** What the leave answers with, `data` and all. */
let leaveAnswer: Record<string, unknown>;

const reply = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
});

const person = (id: string) => ({ _id: id, username: id, image: null });

const item = (id: string, status: string, bookedBy: string | null = null) => ({
  _id: id,
  wishlist: 'w1',
  name: `Item ${id}`,
  status,
  bookedBy,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
});

const fetchMock = vi.fn();
const requests = (url: string, method: string) =>
  fetchMock.mock.calls.filter(([u, init]) => u === url && (init?.method ?? 'GET') === method);

beforeAll(() => {
  // The dialogs' scroll lock puts the page back with scrollTo, which jsdom lacks.
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterAll(() => vi.restoreAllMocks());

beforeEach(() => {
  fetchMock.mockReset();
  router.push.mockReset();
  showToast.mockReset();
  owners = ['alice'];
  memberIds = ['carol'];
  userRole = 'owner';
  items = [];
  leaveAnswer = { success: true, data: { unbookedItemsCount: 0 } };
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url === '/api/wishlists/birthday' && method === 'GET') {
      return reply({
        success: true,
        data: {
          _id: 'birthday',
          name: 'Birthday',
          slug: 'birthday',
          description: '',
          owners: [...owners],
          ownerUsernames: [...owners],
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
    if (url === '/api/wishlists/birthday/items' && method === 'GET') {
      if (!items) return reply({ success: false, error: 'Failed to fetch items' }, 500);
      return reply({ success: true, data: items });
    }
    if (url === '/api/wishlists/birthday/members' && method === 'GET') {
      return reply({
        success: true,
        data: [
          ...owners.map((id) => ({ _id: id, user: person(id), role: 'owner' })),
          ...memberIds.map((id) => ({ _id: `m-${id}`, user: person(id), role: 'member' })),
        ],
      });
    }
    if (url === '/api/wishlists/birthday/members/me' && method === 'DELETE') {
      return reply(leaveAnswer);
    }
    if (method === 'DELETE') return reply({ success: true });
    // Invites, rates.
    if (method === 'GET') return reply({ success: true, data: [] });
    return reply({ success: false, error: 'Not mocked' }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The icon in a confirmation's chip. */
const iconOf = (dialog: HTMLElement) =>
  dialog.querySelector('[data-icon]')?.getAttribute('data-icon');

/** Once the page has drawn the items it read. */
const itemsShown = async () => {
  if (items?.length) await screen.findByText(`Item ${items[0]._id}`);
};

async function openPeople(user: ReturnType<typeof userEvent.setup>) {
  await openListTab(user, 'People');
  await screen.findByRole('link', { name: '@alice' });
}

async function openSettings(user: ReturnType<typeof userEvent.setup>) {
  await openListTab(user, 'Settings');
  await screen.findByRole('heading', { name: 'Danger zone' });
}

describe("a member's Leave", () => {
  beforeEach(() => {
    owners = ['bob'];
    memberIds = [];
    userRole = 'member';
  });

  // regression: it said "All your bookings will be removed", but leaving frees
  // the items and keeps the reservations, so the gifter can still log the gift
  // from their Reserved page. It also showed a trash can.
  it('regression: says what they reserved stays on their Reserved page, counting their own gifts, with a leave icon', async () => {
    items = [
      item('1', 'booked', 'alice'),
      item('2', 'booked', 'alice'),
      item('3', 'booked', 'dave'),
      item('4', 'available'),
    ];
    const user = userEvent.setup();
    render(<WishlistDetail />);
    await itemsShown();

    await pickLeave(user);

    const dialog = await screen.findByRole('alertdialog', { name: 'Leave “Birthday”?' });
    // Two of their own: Dave's booking isn't theirs to count.
    expect(dialog).toHaveAccessibleDescription(
      "You'll lose access. The 2 gifts you reserved here go back on the list, but stay on your Reserved page so you can still log them."
    );
    expect(iconOf(dialog)).toBe('logout');
    expect(dialog).not.toHaveTextContent(/removed|deleted/i);
  });

  it('says the same of anything they reserved when the page shows none of theirs', async () => {
    // Dave's booking is in the page's read but under Reserved by others, which a
    // member's default filter hides, so `itemsShown` waits for the available
    // item: once it's drawn the read has landed and the count (0) is known.
    items = [item('1', 'available'), item('2', 'booked', 'dave')];
    const user = userEvent.setup();
    render(<WishlistDetail />);
    await itemsShown();

    await pickLeave(user);

    const dialog = await screen.findByRole('alertdialog', { name: 'Leave “Birthday”?' });
    expect(dialog).toHaveAccessibleDescription(
      "You'll lose access. Anything you reserved here goes back on the list, but stays on your Reserved page so you can still log it."
    );
    expect(iconOf(dialog)).toBe('logout');
  });

  // regression: the leave's answer carries how many items it freed, and the
  // page dropped it ("Left wishlist successfully").
  it('regression: tells them, once they have left, how many of their reserved gifts were released', async () => {
    leaveAnswer = { success: true, data: { unbookedItemsCount: 2 } };
    const user = userEvent.setup();
    render(<WishlistDetail />);

    await pickLeave(user);
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Leave' }));

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        "You left “Birthday” · 2 gifts you'd reserved here were released",
        'success'
      )
    );
    expect(router.push).toHaveBeenCalledWith('/');
  });

  it('says only that they left when nothing of theirs was released', async () => {
    const user = userEvent.setup();
    render(<WishlistDetail />);

    await pickLeave(user);
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Leave' }));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith('You left “Birthday”', 'success'));
  });
});

describe("an owner's confirmations", () => {
  beforeEach(() => {
    owners = ['alice', 'bob'];
    memberIds = ['carol'];
    // An owner's read never says who booked what (booked folds into
    // available). These do, to show the dialogs would leave such data out even
    // if the page held it.
    items = [
      item('1', 'booked', 'carol'),
      item('2', 'booked', 'carol'),
      item('3', 'draft'),
      item('4', 'proposed'),
    ];
  });

  // regression: it read "remove carol" (no @) and said nothing of what removing
  // does, under a trash can.
  it("regression: removing a member says what they lose and what they're told, with no count of their reservations", async () => {
    const user = userEvent.setup();
    render(<WishlistDetail />);
    await itemsShown();
    await openPeople(user);
    await screen.findByRole('link', { name: '@carol' });

    await pickRowAction(user, 'carol', 'Remove');

    const dialog = await screen.findByRole('alertdialog', { name: 'Remove @carol?' });
    expect(dialog).toHaveAccessibleDescription(
      "They lose access, anything they reserved here goes back on the list, and they're told they were removed (not by whom)."
    );
    expect(iconOf(dialog)).toBe('user-minus');
    // Owners never see booking status: no count, however much Carol holds.
    expect(dialog).not.toHaveTextContent(/\d/);

    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(requests('/api/wishlists/birthday/members/m-carol', 'DELETE')).toHaveLength(1)
    );
  });

  it('removing a co-owner says what they lose and that they are told, with no count either', async () => {
    const user = userEvent.setup();
    render(<WishlistDetail />);
    await itemsShown();
    await openPeople(user);
    await waitFor(() => expect(screen.getAllByRole('link', { name: '@bob' })).toHaveLength(2));

    await pickRowAction(user, 'bob', 'Remove');

    const dialog = await screen.findByRole('alertdialog', { name: 'Remove @bob as an owner?' });
    expect(dialog).toHaveAccessibleDescription(
      "They lose access, and it comes off their profile and dashboard. They're told they were removed (not by whom)."
    );
    expect(iconOf(dialog)).toBe('user-minus');
    expect(dialog).not.toHaveTextContent(/\d|reserv|book/i);
  });

  it('a co-owner stepping down is told what they lose, with a leave icon and no count', async () => {
    const user = userEvent.setup();
    render(<WishlistDetail />);
    await itemsShown();

    await pickLeave(user);

    const dialog = await screen.findByRole('alertdialog', { name: 'Leave “Birthday”?' });
    expect(dialog).toHaveAccessibleDescription(
      "You'll stop being an owner and lose access. It comes off your profile and dashboard, and the other owners keep it."
    );
    expect(iconOf(dialog)).toBe('logout');
    expect(dialog).not.toHaveTextContent(/\d|reserv|book/i);
  });

  // regression: the dialog said bookings "will be permanently deleted", and the
  // Danger zone above it disagreed with it. Deleting a list keeps every
  // reservation (they're the gifters'); an owner is told about neither.
  it('regression: deleting says its items and everyone’s access go, as the Danger zone does, and nothing about reservations', async () => {
    const user = userEvent.setup();
    render(<WishlistDetail />);
    await itemsShown();
    await openSettings(user);

    const zone = screen.getByRole('heading', { name: 'Danger zone' }).closest('section')!;
    expect(zone).toHaveTextContent(
      "Deleting this wishlist takes its items and everyone's access with it. This can't be undone."
    );
    await user.click(within(zone).getByRole('button', { name: 'Delete' }));

    const dialog = await screen.findByRole('alertdialog', { name: 'Delete “Birthday”?' });
    // Every item goes, the draft and the proposal included.
    expect(dialog).toHaveAccessibleDescription(
      "Its 4 items and everyone's access go with it. This can't be undone."
    );
    expect(iconOf(dialog)).toBe('trash');
    expect(dialog).not.toHaveTextContent(/reserv|book/i);
  });

  it("doesn't count the items before it has read them", async () => {
    items = null;
    const user = userEvent.setup();
    render(<WishlistDetail />);
    await screen.findByRole('heading', { name: 'Couldn’t load this list’s items' });
    await openSettings(user);

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    const dialog = await screen.findByRole('alertdialog', { name: 'Delete “Birthday”?' });
    expect(dialog).toHaveAccessibleDescription(
      "Its items and everyone's access go with it. This can't be undone."
    );
  });
});
