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

// The header has its own fetches and tests; this file is about leaving.
vi.mock('@/components/AppHeader', () => ({ default: () => null }));
vi.mock('@/components/AuthButton', () => ({ default: () => null }));

vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));

import WishlistDetail from '@/app/wishlists/[id]/page';

// User ids double as usernames here. Alice is signed in.
let owners: string[];
let userRole: 'owner' | 'member';

const reply = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
});

const person = (id: string) => ({ _id: id, username: id, image: null });

const fetchMock = vi.fn();
/** The requests that would take Alice off the list. */
const leaveRequests = () =>
  fetchMock.mock.calls.filter(
    ([url, init]) => url === '/api/wishlists/birthday/members/me' && init?.method === 'DELETE'
  );

// jsdom has no scrollIntoView: stand one in, to see the invite form scrolled to.
const scrollIntoView = vi.fn();
// Nor scrollTo, which the dialog's scroll lock puts the page back with on close.
const scrollTo = vi.fn();
beforeAll(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(scrollTo);
});
afterAll(() => vi.restoreAllMocks());

beforeEach(() => {
  fetchMock.mockReset();
  scrollIntoView.mockReset();
  scrollTo.mockReset();
  Element.prototype.scrollIntoView = scrollIntoView;
  owners = ['alice'];
  userRole = 'owner';
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
          owners: [...owners],
          ownerUsernames: [...owners],
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
    if (url === '/api/wishlists/birthday/members' && method === 'GET') {
      return reply({
        success: true,
        data: [
          ...owners.map((id) => ({ _id: id, user: person(id), role: 'owner' })),
          { _id: 'm-carol', user: person('carol'), role: 'member' },
        ],
      });
    }
    if (url === '/api/wishlists/birthday/members/me' && method === 'DELETE') {
      return reply({ success: true, data: {} });
    }
    // Items, invites, rates.
    if (method === 'GET') return reply({ success: true, data: [] });
    return reply({ success: false, error: 'Not mocked' }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (Element.prototype as Partial<Element>).scrollIntoView;
});

/** The title row: the list's name, its byline, and the header's actions (Leave, Manage). */
const titleRow = () =>
  screen.getByRole('heading', { level: 1, name: 'Birthday' }).parentElement!.parentElement!;
const headerLeave = () => within(titleRow()).queryByRole('button', { name: 'Leave' });

/** Open Manage and wait for the owners' rows. Returns the Leave on Alice's own row. */
async function openManage(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Manage wishlist' }));
  await screen.findByRole('link', { name: '@alice' });
  const leave = screen.getAllByRole('button', { name: 'Leave' }).filter((b) => b !== headerLeave());
  expect(leave).toHaveLength(1);
  return leave[0];
}

describe('Leave for the sole owner of a list', () => {
  it("keeps the header's Leave hidden, and offers one on their own owner row", async () => {
    const user = userEvent.setup();
    render(<WishlistDetail />);
    await screen.findByRole('button', { name: 'Manage wishlist' });
    expect(headerLeave()).toBeNull();

    const leave = await openManage(user);
    expect(headerLeave()).toBeNull();
    // On Alice's row, next to "You".
    expect(leave.parentElement).toHaveTextContent('You');
  });

  it("explains why they can't leave instead of asking to confirm, and leaves nothing", async () => {
    const user = userEvent.setup();
    render(<WishlistDetail />);
    const leave = await openManage(user);

    await user.click(leave);

    const dialog = await screen.findByRole('alertdialog', { name: "You're the only owner" });
    expect(dialog).toHaveAccessibleDescription(
      'A wishlist needs at least one owner. To leave, invite a co-owner first; once they accept, you can leave. Or delete the wishlist instead.'
    );
    // Nothing in it leaves or deletes: only the way to a co-owner, or back.
    expect(
      within(dialog)
        .getAllByRole('button')
        .map((b) => b.textContent)
    ).toEqual(['Cancel', 'Invite a co-owner']);
    expect(dialog).not.toHaveTextContent(/book|reserv/i);
    expect(screen.queryByRole('alertdialog', { name: 'Leave Wishlist' })).toBeNull();

    // Cancel closes it, back on the Leave that opened it.
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    await waitFor(() => expect(leave).toHaveFocus());
    expect(leaveRequests()).toHaveLength(0);
  });

  it('takes them to the invite form, set to invite an owner, from "Invite a co-owner"', async () => {
    const user = userEvent.setup();
    render(<WishlistDetail />);
    const leave = await openManage(user);
    const field = screen.getByPlaceholderText('Search by username');
    expect(screen.getByRole('combobox', { name: 'Role' })).toHaveTextContent('Member');

    await user.click(leave);
    const dialog = await screen.findByRole('alertdialog', { name: "You're the only owner" });
    await user.click(within(dialog).getByRole('button', { name: 'Invite a co-owner' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(field).toHaveFocus();
    expect(screen.getByRole('combobox', { name: 'Role' })).toHaveTextContent('Owner');
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toContainElement(field);
    // Only once the dialog's scroll lock has put the page back where it was,
    // which would otherwise scroll it away from the form again.
    expect(scrollTo).toHaveBeenCalled();
    expect(scrollIntoView.mock.invocationCallOrder[0]).toBeGreaterThan(
      Math.max(...scrollTo.mock.invocationCallOrder)
    );
    // Focus stays there once the dialog's own focus return has run.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(field).toHaveFocus();
    expect(leaveRequests()).toHaveLength(0);

    // The invite goes out as an owner invite.
    await user.type(field, 'dave');
    await user.click(screen.getByRole('button', { name: 'Invite' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/wishlists/birthday/members',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ username: 'dave', role: 'owner' }),
        })
      )
    );
  });
});

describe('Leave once the co-owner the sole owner invited has accepted', () => {
  // The way out the notice points to has to work without a reload: the page
  // counted its owners when it loaded, before the co-owner accepted.
  it('asks to confirm instead of explaining again once Manage is opened afresh', async () => {
    const user = userEvent.setup();
    render(<WishlistDetail />);
    await openManage(user);
    await user.click(screen.getAllByRole('button', { name: 'Back to items' })[0]);

    // Bob accepts the owner invite on his own device.
    owners = ['alice', 'bob'];
    const leave = await openManage(user);
    await waitFor(() => expect(headerLeave()).toBeInTheDocument());

    await user.click(leave);

    expect(await screen.findByRole('alertdialog', { name: 'Leave Wishlist' })).toHaveTextContent(
      'Step down as an owner of this wishlist?'
    );
    expect(screen.queryByRole('alertdialog', { name: "You're the only owner" })).toBeNull();
    // Bob's row can be stepped down too, now that the page counts two owners.
    expect(screen.getByRole('button', { name: 'Make member' })).toBeInTheDocument();
  });
});

describe('Leave for everyone who can leave', () => {
  it('asks an owner with a co-owner to confirm stepping down, and leaves once they do', async () => {
    owners = ['alice', 'bob'];
    const user = userEvent.setup();
    render(<WishlistDetail />);
    expect(await screen.findByRole('button', { name: 'Leave' })).toBe(headerLeave());
    const leave = await openManage(user);

    await user.click(leave);

    const dialog = await screen.findByRole('alertdialog', { name: 'Leave Wishlist' });
    expect(dialog).toHaveTextContent('Step down as an owner of this wishlist?');
    expect(screen.queryByRole('alertdialog', { name: "You're the only owner" })).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Leave' }));
    await waitFor(() => expect(leaveRequests()).toHaveLength(1));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/'));
  });

  it("gives a member the header's Leave and its confirmation, as before", async () => {
    owners = ['bob'];
    userRole = 'member';
    const user = userEvent.setup();
    render(<WishlistDetail />);

    const leave = await screen.findByRole('button', { name: 'Leave' });
    expect(leave).toBe(headerLeave());
    // A member doesn't manage the list, so they have no owner row to leave from.
    expect(screen.queryByRole('button', { name: 'Manage wishlist' })).toBeNull();

    await user.click(leave);

    const dialog = await screen.findByRole('alertdialog', { name: 'Leave Wishlist' });
    expect(dialog).toHaveTextContent('Are you sure you want to leave this wishlist?');
    await user.click(within(dialog).getByRole('button', { name: 'Leave' }));
    await waitFor(() => expect(leaveRequests()).toHaveLength(1));
  });
});
