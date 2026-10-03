// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, within, act } from '@testing-library/react';
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

// The header has its own fetches and tests; this file is about the owners.
vi.mock('@/components/AppHeader', () => ({ default: () => null }));
vi.mock('@/components/AuthButton', () => ({ default: () => null }));

vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));

import WishlistDetail from '@/app/wishlists/[id]/page';

// User ids double as usernames here.
interface Server {
  owners: string[];
  members: string[];
  description: string;
}

/** The list as the server has it. Alice is signed in and owns it. */
let server: Server;
/**
 * Holds the next read of the list (GET), settings save (PATCH) or demotion
 * (PATCH on an owner) until it's released.
 */
let held: { read?: Promise<void>; save?: Promise<void>; demote?: Promise<void> };
/** How many reads of the list the page has taken the answer of. */
let listReads: number;

const reply = (body: unknown, status = 200, onRead?: () => void) => ({
  ok: status < 400,
  status,
  json: async () => {
    onRead?.();
    return body;
  },
});

/** The list as the API answers it. */
function listBody(s: Server) {
  return {
    _id: 'w1',
    name: 'Birthday',
    slug: 'birthday',
    description: s.description,
    owners: [...s.owners],
    visibility: 'everyone',
    isPublic: true,
    archived: false,
    featured: false,
    currency: 'EUR',
    bannerUrl: null,
    occasion: null,
  };
}

const person = (id: string) => ({ _id: id, username: id, image: null });

const fetchMock = vi.fn();

// useBodyScrollLock restores the scroll position on close; jsdom lacks scrollTo.
beforeAll(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterAll(() => vi.restoreAllMocks());

/** Something to await that resolves once `release` is called. */
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => (release = resolve));
  return { promise, release };
}

beforeEach(() => {
  fetchMock.mockReset();
  server = { owners: ['alice', 'bob'], members: [], description: 'Things I would like' };
  held = {};
  listReads = 0;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url === '/api/wishlists/birthday' && method === 'GET') {
      // Answered with the list as it is when the request arrives, however late
      // the answer gets back.
      const body = {
        success: true,
        data: { ...listBody(server), userRole: 'owner', ownerUsernames: [...server.owners] },
      };
      const wait = held.read;
      held.read = undefined;
      await wait;
      return reply(body, 200, () => (listReads += 1));
    }
    if (url === '/api/wishlists/birthday' && method === 'PATCH') {
      // The settings save's one write lands now; its answer is the list as that
      // write left it.
      server = { ...server, ...JSON.parse(String(init?.body)) };
      const written = listBody(server);
      const wait = held.save;
      held.save = undefined;
      await wait;
      return reply({ success: true, data: written });
    }
    if (url === '/api/wishlists/birthday/members') {
      return reply({
        success: true,
        data: [
          ...server.owners.map((id) => ({ _id: id, user: person(id), role: 'owner' })),
          ...server.members.map((id) => ({ _id: `m-${id}`, user: person(id), role: 'member' })),
        ],
      });
    }
    const owner = /^\/api\/wishlists\/birthday\/owners\/([^/]+)$/.exec(url)?.[1];
    if (owner && (method === 'PATCH' || method === 'DELETE')) {
      if (method === 'PATCH') {
        const wait = held.demote;
        held.demote = undefined;
        await wait;
      }
      if (!server.owners.includes(owner)) {
        return reply({ success: false, error: 'This person is not an owner' }, 404);
      }
      server.owners = server.owners.filter((id) => id !== owner);
      if (method === 'PATCH') {
        server.members = [owner, ...server.members];
        return reply({ success: true, data: { role: 'member', user: person(owner) } });
      }
      return reply({ success: true, data: {} });
    }
    // Items, invites.
    if (url.startsWith('/api/wishlists/birthday/') && method === 'GET') {
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

async function openManage() {
  const user = userEvent.setup();
  render(<WishlistDetail />);
  await user.click(await screen.findByRole('button', { name: 'Manage wishlist' }));
  await screen.findAllByRole('button', { name: 'Make member' });
  // The page's first read of the list, and the one opening Manage takes.
  await waitFor(() => expect(listReads).toBe(2));
  await settle();
  return user;
}

/** The title row, whose byline credits every owner ("by you & @bob"). */
const byline = () => screen.getByRole('heading', { level: 1, name: 'Birthday' }).parentElement!;
/** The header's Leave and the one on Alice's own owner row. */
const leaveButtons = () => screen.queryAllByRole('button', { name: 'Leave' });
/** The header's Leave alone: only an owner who may leave (one with a co-owner) gets it. */
const headerLeave = () => within(byline().parentElement!).queryByRole('button', { name: 'Leave' });
const credited = (username: string) =>
  within(byline()).queryByRole('link', { name: `@${username}` });

/**
 * Alice is the only owner left, so nothing offers to take her off the list (the
 * server would refuse it): the header's Leave is gone, and the one on her own
 * row only explains why.
 */
function expectSoleOwner() {
  expect(headerLeave()).toBeNull();
  expect(leaveButtons()).toHaveLength(1);
}

/** Make member's dialog, which asks before `username` is made a member. */
const demoteDialog = (username: string) =>
  screen.findByRole('alertdialog', { name: `Make @${username} a member?` });

/** The demotions the page has sent. */
const demotions = () =>
  fetchMock.mock.calls.filter(
    ([url, init]) =>
      /^\/api\/wishlists\/birthday\/owners\//.test(url) &&
      (init as RequestInit | undefined)?.method === 'PATCH'
  );

/**
 * Make the first co-owner listed (`username`) a member, confirming it in the
 * dialog, and wait for the members to move them.
 */
async function demoteFirst(user: ReturnType<typeof userEvent.setup>, username: string) {
  const demoted = screen.queryAllByRole('button', { name: 'Make owner' }).length;
  const calls = showToast.mock.calls.length;
  await user.click(screen.getAllByRole('button', { name: 'Make member' })[0]);
  const dialog = await demoteDialog(username);
  await user.click(within(dialog).getByRole('button', { name: 'Make member' }));
  await waitFor(() => expect(showToast).toHaveBeenCalledTimes(calls + 1));
  expect(showToast).toHaveBeenLastCalledWith(`@${username} is now a member`, 'success');
  await waitFor(() =>
    expect(screen.getAllByRole('button', { name: 'Make owner' })).toHaveLength(demoted + 1)
  );
  // It closes once the reads after the demotion have landed.
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
}

/** Let a read whose answer the page has just taken finish landing. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

describe('the wishlist page after an owner is demoted or removed', () => {
  // regression: Make member refreshed only the members and invites, never the
  // list, so the page still counted Bob as an owner. Alice, now the only one,
  // was still offered Leave, which the server refuses ("You are the only
  // owner"), and the byline still credited him.
  it('regression: after demoting the only other co-owner, Leave no longer leaves and the byline drops them', async () => {
    const user = await openManage();
    expect(leaveButtons()).toHaveLength(2);
    expect(headerLeave()).toBeInTheDocument();
    expect(credited('bob')).toBeInTheDocument();

    await demoteFirst(user, 'bob');

    expectSoleOwner();
    expect(credited('bob')).not.toBeInTheDocument();
    expect(within(byline()).getByText('you')).toBeInTheDocument();
    // Her row's Leave explains instead of asking to confirm a leave.
    await user.click(leaveButtons()[0]);
    expect(
      await screen.findByRole('alertdialog', { name: "You're the only owner" })
    ).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog', { name: 'Leave “Birthday”?' })).toBeNull();
  });

  // regression: Remove on an owner row had the same gap as Make member.
  it('regression: after removing the only other co-owner, Leave no longer leaves and the byline drops them', async () => {
    const user = await openManage();
    expect(leaveButtons()).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Remove' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Remove @bob as an owner?');
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Owner removed', 'success'));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());

    expectSoleOwner();
    expect(credited('bob')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '@bob' })).not.toBeInTheDocument();
  });

  it('still offers Leave while another co-owner remains, and drops only the demoted one', async () => {
    server.owners = ['alice', 'bob', 'carol'];
    const user = await openManage();

    await demoteFirst(user, 'bob');

    expect(leaveButtons()).toHaveLength(2);
    expect(headerLeave()).toBeInTheDocument();
    expect(credited('bob')).not.toBeInTheDocument();
    expect(credited('carol')).toBeInTheDocument();
    // Carol can still be stepped down: there are two owners left.
    expect(screen.getByRole('button', { name: 'Make member' })).toBeInTheDocument();
  });

  it('takes the owners from the server after the change, a co-owner who joined meanwhile included', async () => {
    const user = await openManage();
    // Dave accepted an owner invite while Alice's page was open.
    server.owners = [...server.owners, 'dave'];

    await demoteFirst(user, 'bob');

    await waitFor(() => expect(credited('dave')).toBeInTheDocument());
    expect(credited('bob')).not.toBeInTheDocument();
    expect(leaveButtons()).toHaveLength(2);
  });

  it('keeps the owners as they were when the demotion fails', async () => {
    const user = await openManage();
    const succeed = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
      init?.method === 'PATCH'
        ? reply({ success: false, error: 'Failed to update owner' }, 500)
        : succeed(url, init)
    );

    await user.click(screen.getByRole('button', { name: 'Make member' }));
    const dialog = await demoteDialog('bob');
    await user.click(within(dialog).getByRole('button', { name: 'Make member' }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Failed to update owner', 'error'));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Make member' })).toBeEnabled());

    expect(leaveButtons()).toHaveLength(2);
    expect(credited('bob')).toBeInTheDocument();
  });

  // The save's write landed before the demotion's, so its answer still lists Bob.
  it("doesn't bring the demoted owner back when a settings save started before it is answered after it", async () => {
    const user = await openManage();
    const save = gate();
    held.save = save.promise;

    await user.type(screen.getByLabelText('Description'), '!');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByRole('button', { name: 'Saving…' });
    await demoteFirst(user, 'bob');
    expectSoleOwner();

    save.release();
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('Wishlist updated successfully', 'success')
    );
    expectSoleOwner();
    expect(credited('bob')).not.toBeInTheDocument();
  });

  // Opening Manage reads the owners again. That read was answered before the
  // demotions landed, so it still lists Bob and Carol, and it gets back only
  // after the reads that follow them have. (A demotion's own read can't be the
  // late one: its dialog stays open until that read has landed.)
  it("doesn't bring back an owner demoted while an earlier read of the owners was in flight", async () => {
    server.owners = ['alice', 'bob', 'carol'];
    const user = userEvent.setup();
    render(<WishlistDetail />);
    const manage = await screen.findByRole('button', { name: 'Manage wishlist' });
    await waitFor(() => expect(listReads).toBe(1));
    const manageRead = gate();
    held.read = manageRead.promise;
    await user.click(manage);
    await screen.findAllByRole('button', { name: 'Make member' });

    await demoteFirst(user, 'bob');
    await demoteFirst(user, 'carol');
    await waitFor(() => expect(listReads).toBe(3));
    await settle();
    expectSoleOwner();

    manageRead.release();
    await waitFor(() => expect(listReads).toBe(4));
    await settle();
    expectSoleOwner();
    expect(credited('bob')).not.toBeInTheDocument();
    expect(credited('carol')).not.toBeInTheDocument();
  });
});

describe('Make member', () => {
  // regression: Make member made a co-owner a member the moment it was clicked,
  // with no confirmation, though it notifies them, it sits right next to
  // Remove, and only they can undo it (making them an owner again is an invite
  // they have to accept). One mis-tap cost a co-owner their ownership.
  it('regression: asks first, sends nothing on Cancel, and sends one demotion once confirmed', async () => {
    const user = await openManage();
    const makeMember = screen.getByRole('button', { name: 'Make member' });

    await user.click(makeMember);
    let dialog = await demoteDialog('bob');
    expect(dialog).toHaveTextContent(
      "They keep access and can reserve gifts, but can no longer edit or manage the list. They'll be notified. Making them an owner again needs their acceptance."
    );
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await settle();
    expect(demotions()).toHaveLength(0);
    expect(showToast).not.toHaveBeenCalled();
    expect(credited('bob')).toBeInTheDocument();
    expect(leaveButtons()).toHaveLength(2);

    // The demotion is held, so it's still in flight when the second click lands.
    const demotion = gate();
    held.demote = demotion.promise;
    await user.click(makeMember);
    dialog = await demoteDialog('bob');
    const confirm = within(dialog).getByRole('button', { name: 'Make member' });
    // Twice before the page re-renders, so only the handlers' own guards can
    // turn the second one away.
    act(() => {
      confirm.click();
      confirm.click();
    });
    expect(within(dialog).getByRole('button', { name: 'Making member…' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    // The row takes no more clicks meanwhile either.
    expect(makeMember).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeDisabled();

    demotion.release();
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('@bob is now a member', 'success'));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(demotions()).toHaveLength(1);
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(server.members).toEqual(['bob']);
    expectSoleOwner();
  });
});
