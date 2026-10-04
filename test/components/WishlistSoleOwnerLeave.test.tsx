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
import {
  listMenuItems,
  listMenuTrigger,
  listTab,
  openListTab,
  pickLeave,
  rowMenuItems,
} from './listMenu';

// User ids double as usernames here. Alice is signed in.
let owners: string[];
let memberIds: string[];
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
  memberIds = ['carol'];
  userRole = 'owner';
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

/** Every button that would take Alice off the list, outside a dialog. */
const leaveButtons = () => screen.queryAllByRole('button', { name: /^Leave/ });

/** Open People and wait for the owners' rows. */
async function openPeople(user: ReturnType<typeof userEvent.setup>) {
  await openListTab(user, 'People');
  await screen.findByRole('link', { name: '@alice' });
}

describe('Leave for the sole owner of a list', () => {
  it('offers Leave list in the title’s ⋯ menu, and no Leave on their own owner row', async () => {
    const user = userEvent.setup();
    render(<WishlistDetail />);
    await listTab('People');
    expect(leaveButtons()).toHaveLength(0);
    expect(await listMenuItems(user)).toEqual(['Pin to my dashboard', 'Leave list']);

    await openPeople(user);
    // regression: a co-owner saw Leave twice, in the header and on their own row.
    expect(leaveButtons()).toHaveLength(0);
    expect(screen.getByText('You')).toBeInTheDocument();
    // Their own row has no menu at all.
    expect(screen.queryByRole('button', { name: 'Actions for @alice' })).toBeNull();
  });

  it("explains why they can't leave instead of asking to confirm, and leaves nothing", async () => {
    const user = userEvent.setup();
    render(<WishlistDetail />);
    await listTab('People');

    await pickLeave(user);

    const dialog = await screen.findByRole('alertdialog', { name: "You're the only owner" });
    // Carol is a member, so the way to her comes first.
    expect(dialog).toHaveAccessibleDescription(
      'A wishlist needs at least one owner. To leave, make someone else an owner first: pick Make owner in one of your members’ menus on People, or invite a co-owner. Once they accept, you can leave. Or delete the wishlist instead.'
    );
    // Nothing in it leaves or deletes: only the way to a co-owner, or back.
    expect(
      within(dialog)
        .getAllByRole('button')
        .map((b) => b.textContent)
    ).toEqual(['Cancel', 'Invite a co-owner']);
    expect(dialog).not.toHaveTextContent(/book|reserv/i);
    expect(screen.queryByRole('alertdialog', { name: 'Leave “Birthday”?' })).toBeNull();

    // Cancel closes it, back on the ⋯ menu that opened it, with People open
    // behind it: Carol's Make owner, which the notice points to, is right there.
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    await waitFor(() => expect(listMenuTrigger()).toHaveFocus());
    expect(await listTab('People')).toHaveAttribute('aria-selected', 'true');
    expect(window.location.search).toBe('?tab=people');
    await screen.findByRole('button', { name: 'Actions for @carol' });
    expect(await rowMenuItems(user, 'carol')).toEqual(['Make owner', 'Remove']);
    expect(leaveRequests()).toHaveLength(0);
  });

  it('only mentions inviting a co-owner when the list has no members to make owner', async () => {
    memberIds = [];
    const user = userEvent.setup();
    render(<WishlistDetail />);
    await listTab('People');
    await pickLeave(user);

    const dialog = await screen.findByRole('alertdialog', { name: "You're the only owner" });
    expect(dialog).toHaveAccessibleDescription(
      'A wishlist needs at least one owner. To leave, invite a co-owner first; once they accept, you can leave. Or delete the wishlist instead.'
    );
  });

  it('takes them to the invite form on People, set to invite an owner, from "Invite a co-owner"', async () => {
    const user = userEvent.setup();
    render(<WishlistDetail />);
    await listTab('People');
    // People isn't open: Leave list opens it on the way to the form.
    expect(screen.queryByPlaceholderText('Search by username')).toBeNull();

    await pickLeave(user);
    const dialog = await screen.findByRole('alertdialog', { name: "You're the only owner" });
    await user.click(within(dialog).getByRole('button', { name: 'Invite a co-owner' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    const field = await screen.findByPlaceholderText('Search by username');
    await waitFor(() => expect(field).toHaveFocus());
    expect(screen.getByRole('radio', { name: 'Co-owner' })).toBeChecked();
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
  it('asks to confirm instead of explaining again, without a reload', async () => {
    const user = userEvent.setup();
    render(<WishlistDetail />);
    await listTab('People');
    await pickLeave(user);
    await user.click(
      within(await screen.findByRole('alertdialog', { name: "You're the only owner" })).getByRole(
        'button',
        { name: 'Cancel' }
      )
    );
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());

    // Bob accepts the owner invite on his own device.
    owners = ['alice', 'bob'];
    await pickLeave(user);

    expect(await screen.findByRole('alertdialog', { name: 'Leave “Birthday”?' })).toHaveTextContent(
      "You'll stop being an owner and lose access."
    );
    expect(screen.queryByRole('alertdialog', { name: "You're the only owner" })).toBeNull();
    // He's credited in the byline now, beside the list's name.
    const byline = screen.getByRole('heading', { level: 1, name: 'Birthday' }).parentElement!;
    expect(within(byline).getByRole('link', { name: '@bob' })).toBeInTheDocument();
  });
});

describe('Leave for everyone who can leave', () => {
  it('asks an owner with a co-owner to confirm stepping down, and leaves once they do', async () => {
    owners = ['alice', 'bob'];
    const user = userEvent.setup();
    render(<WishlistDetail />);
    await listTab('People');
    expect(leaveButtons()).toHaveLength(0);

    await pickLeave(user);

    const dialog = await screen.findByRole('alertdialog', { name: 'Leave “Birthday”?' });
    expect(dialog).toHaveTextContent("You'll stop being an owner and lose access.");
    expect(screen.queryByRole('alertdialog', { name: "You're the only owner" })).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Leave' }));
    await waitFor(() => expect(leaveRequests()).toHaveLength(1));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/'));
  });

  it('gives a member Leave list in the ⋯ menu, beside Propose and Share, and its confirmation', async () => {
    owners = ['bob'];
    userRole = 'member';
    const user = userEvent.setup();
    render(<WishlistDetail />);

    await screen.findByRole('button', { name: 'Propose' });
    // Off the action row, where it sat with the weight of Share.
    expect(leaveButtons()).toHaveLength(0);
    // A member doesn't manage the list: no tabs, and the menu holds Leave list alone.
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(await listMenuItems(user)).toEqual(['Leave list']);

    await pickLeave(user);

    const dialog = await screen.findByRole('alertdialog', { name: 'Leave “Birthday”?' });
    expect(dialog).toHaveTextContent("You'll lose access.");
    await user.click(within(dialog).getByRole('button', { name: 'Leave' }));
    await waitFor(() => expect(leaveRequests()).toHaveLength(1));
  });
});
