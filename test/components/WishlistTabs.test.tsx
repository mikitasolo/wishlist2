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

// The header has its own fetches and tests; this file is about the tabs.
vi.mock('@/components/AppHeader', () => ({ default: () => null }));
vi.mock('@/components/AuthButton', () => ({ default: () => null }));

vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));

import WishlistDetail from '@/app/wishlists/[id]/page';
import { NO_MEMBERS_TEXT } from '@/components/WishlistPeopleTab';
import { listTab, openListTab, rowMenuItem, rowMenuItems, pickRowAction } from './listMenu';

// User ids double as usernames here. Alice is signed in.
let owners: string[];
let memberIds: string[];
let userRole: 'owner' | 'member' | null;
let invites: { _id: string; role: 'owner' | 'member'; username: string; image: null }[];
/** Whether the people read fails. */
let membersFail: boolean;
/** Holds the next invite cancel until it's released. */
let heldCancel: Promise<void> | undefined;

const reply = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
});

const person = (id: string) => ({ _id: id, username: id, image: null });

const fetchMock = vi.fn();
const requests = (url: string, method: string) =>
  fetchMock.mock.calls.filter(([u, init]) => u === url && (init?.method ?? 'GET') === method);

beforeAll(() => {
  // useBodyScrollLock restores the scroll position on close; jsdom lacks scrollTo.
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterAll(() => vi.restoreAllMocks());

beforeEach(() => {
  fetchMock.mockReset();
  showToast.mockReset();
  owners = ['alice', 'bob'];
  memberIds = ['carol', 'dave'];
  userRole = 'owner';
  invites = [
    // Dave, a member, has been asked to become an owner.
    { _id: 'inv-dave', role: 'owner', username: 'dave', image: null },
    { _id: 'inv-erin', role: 'member', username: 'erin', image: null },
    { _id: 'inv-finn', role: 'owner', username: 'finn', image: null },
  ];
  membersFail = false;
  heldCancel = undefined;
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
      if (membersFail) return reply({ success: false, error: 'Server error' }, 500);
      return reply({
        success: true,
        data: [
          ...owners.map((id) => ({ _id: id, user: person(id), role: 'owner' })),
          ...memberIds.map((id) => ({ _id: `m-${id}`, user: person(id), role: 'member' })),
        ],
      });
    }
    if (url === '/api/wishlists/birthday/invites' && method === 'GET') {
      return reply({ success: true, data: [...invites] });
    }
    const cancelled = /^\/api\/wishlists\/birthday\/invites\/([^/]+)$/.exec(url)?.[1];
    if (cancelled && method === 'DELETE') {
      const wait = heldCancel;
      heldCancel = undefined;
      await wait;
      invites = invites.filter((i) => i._id !== cancelled);
      return reply({ success: true, data: {} });
    }
    // Items, rates.
    if (method === 'GET') return reply({ success: true, data: [] });
    return reply({ success: false, error: 'Not mocked' }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The page opened at `search` (the list's URL's query). */
function openAt(search = '') {
  window.history.replaceState(null, '', `/wishlists/birthday${search}`);
  render(<WishlistDetail />);
}

const selectedTab = () => screen.getByRole('tab', { selected: true });
const onItems = () => screen.findByRole('heading', { name: 'Your list is empty' });
const onPeople = () => screen.findByRole('heading', { name: 'Invite someone' });
const onSettings = () => screen.findByRole('heading', { name: 'About' });
const peoplePanel = () => screen.getByRole('region', { name: 'People on this list' });
/** The caption under `username` on their People row. */
const captionOf = (username: string) =>
  within(peoplePanel()).getByRole('link', { name: `@${username}` }).nextElementSibling?.textContent;

describe("an owner's tabs", () => {
  it('shows Items · People (n) · Settings, and opens on Items with no ?tab=', async () => {
    openAt();
    await onItems();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Items', 'People4', 'Settings']);
    expect(selectedTab()).toHaveTextContent('Items');
    // The selected tab labels the panel under the bar.
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Items');
    // No Manage, Done or chevron any more.
    expect(screen.queryByRole('button', { name: /Manage|Back to items/ })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Manage wishlist' })).toBeNull();
  });

  // regression: Manage was component state, so back left the list, a refresh
  // dropped the owner on Items, and nothing could link to it.
  it('regression: opens People at ?tab=people, and back returns to Items', async () => {
    openAt('?tab=people');
    await onPeople();
    expect(selectedTab()).toHaveTextContent('People');
    expect(screen.queryByRole('heading', { name: 'Your list is empty' })).toBeNull();

    await openListTab(userEvent.setup(), 'Settings');
    await onSettings();
    expect(window.location.search).toBe('?tab=settings');

    act(() => window.history.back());
    await onPeople();
    expect(window.location.search).toBe('?tab=people');
  });

  it('puts the tab in the URL, keeps the rest of the query, and back goes to Items', async () => {
    openAt('?from=chat');
    const user = userEvent.setup();
    await onItems();

    await openListTab(user, 'People');
    await onPeople();
    expect(window.location.search).toBe('?from=chat&tab=people');

    act(() => window.history.back());
    await onItems();
    expect(selectedTab()).toHaveTextContent('Items');
    expect(window.location.search).toBe('?from=chat');
  });

  it('opens Settings at ?tab=settings', async () => {
    openAt('?tab=settings');
    await onSettings();
    expect(selectedTab()).toHaveTextContent('Settings');
    for (const section of ['About', 'Who can see it', 'Advanced', 'Danger zone']) {
      expect(screen.getByRole('heading', { name: section })).toBeInTheDocument();
    }
    // Pin to my dashboard is the title's ⋯, not a setting of the list.
    expect(screen.queryByText(/Pin to my dashboard/)).toBeNull();
  });

  it('moves between tabs from the keyboard: the arrows move focus, Enter opens one', async () => {
    openAt();
    const user = userEvent.setup();
    await onItems();
    const items = await listTab('Items');
    // The selected tab is the one Tab stop.
    expect(items).toHaveAttribute('tabindex', '0');
    expect(await listTab('People')).toHaveAttribute('tabindex', '-1');

    items.focus();
    await user.keyboard('{ArrowRight}');
    expect(await listTab('People')).toHaveFocus();
    // Moving focus alone doesn't open it (or leave a history entry).
    expect(window.location.search).toBe('');
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(items).toHaveFocus();
    await user.keyboard('{End}{Enter}');
    await onSettings();
    expect(window.location.search).toBe('?tab=settings');
  });

  it('takes Add item back to Items, where the item will land', async () => {
    openAt('?tab=settings');
    const user = userEvent.setup();
    await onSettings();
    await user.click(screen.getByRole('button', { name: 'Add item' }));
    expect(await screen.findByRole('dialog', { name: 'Add new item' })).toBeInTheDocument();
    expect(window.location.search).toBe('');
  });
});

describe('the tabs for anyone but an owner', () => {
  it.each(['?tab=people', '?tab=settings'])(
    'shows a member Items at %s, with no tabs and the URL left alone',
    async (search) => {
      userRole = 'member';
      owners = ['bob'];
      openAt(search);
      await screen.findByRole('button', { name: 'Propose' });
      expect(screen.queryByRole('tablist')).toBeNull();
      expect(screen.queryByRole('tabpanel')).toBeNull();
      expect(screen.getByRole('heading', { name: 'Nothing here yet' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Invite someone' })).toBeNull();
      expect(screen.queryByRole('heading', { name: 'About' })).toBeNull();
      expect(window.location.search).toBe(search);
      // Members never read the people on the list.
      expect(requests('/api/wishlists/birthday/members', 'GET')).toHaveLength(0);
      expect(requests('/api/wishlists/birthday/invites', 'GET')).toHaveLength(0);
    }
  );

  it('shows a visitor Items at ?tab=people', async () => {
    userRole = null;
    owners = ['bob'];
    openAt('?tab=people');
    await screen.findByRole('heading', { name: 'No items yet' });
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(requests('/api/wishlists/birthday/members', 'GET')).toHaveLength(0);
  });
});

describe('People', () => {
  it('lists Owners, Members and Invited, one line each, with what can be done about each', async () => {
    openAt('?tab=people');
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'Actions for @bob' });

    const groups = within(peoplePanel())
      .getAllByRole('heading', { level: 3 })
      .map((h) => h.textContent);
    expect(groups).toEqual(['Owners', 'Members', 'Invited']);

    // Yourself: "You", and no menu (Leave list… is in the title's ⋯).
    expect(captionOf('alice')).toBe('You');
    expect(screen.queryByRole('button', { name: 'Actions for @alice' })).toBeNull();
    // Another owner.
    expect(captionOf('bob')).toBe('Owner');
    expect(await rowMenuItems(user, 'bob')).toEqual(['Make member…', 'Remove…']);
    // A member.
    expect(captionOf('carol')).toBe('Member');
    expect(await rowMenuItems(user, 'carol')).toEqual(['Make owner…', 'Remove…']);
    // A member with an owner invite pending: no second Make owner.
    expect(captionOf('dave')).toBe('Owner invite pending');
    expect(await rowMenuItems(user, 'dave')).toEqual(['Cancel invite', 'Remove…']);

    // The invites, but not Dave's again.
    const invited = within(peoplePanel());
    expect(invited.queryAllByRole('link', { name: '@dave' })).toHaveLength(1);
    expect(captionOf('erin')).toBe('Invited as member');
    expect(captionOf('finn')).toBe('Invited as co-owner');
    expect(screen.getByRole('button', { name: 'Cancel the invite to @erin' })).toHaveTextContent(
      'Cancel'
    );
    // Nobody's email, anywhere.
    expect(document.body).not.toHaveTextContent(/@example|\w@\w+\./);
  });

  it('offers no owner changes when you are the only owner', async () => {
    owners = ['alice'];
    openAt('?tab=people');
    await screen.findByRole('button', { name: 'Actions for @carol' });
    expect(captionOf('alice')).toBe('You');
    expect(screen.queryByRole('button', { name: 'Actions for @alice' })).toBeNull();
    expect(screen.getAllByRole('tab')[1]).toHaveTextContent('People3');
  });

  it('says how members get on when there are none', async () => {
    memberIds = [];
    invites = [];
    openAt('?tab=people');
    expect(await screen.findByText(NO_MEMBERS_TEXT)).toBeInTheDocument();
    expect(NO_MEMBERS_TEXT).toBe(
      'No members yet. Members can reserve gifts. Invite people above, or share the link so they can view it.'
    );
    expect(within(peoplePanel()).queryByRole('heading', { name: 'Invited' })).toBeNull();
  });

  it('asks before Make owner…, Make member… and Remove…', async () => {
    openAt('?tab=people');
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'Actions for @bob' });

    for (const [username, action, dialog] of [
      ['carol', 'Make owner…', 'Make owner?'],
      ['bob', 'Make member…', 'Make @bob a member?'],
      ['bob', 'Remove…', 'Remove @bob as an owner?'],
      ['carol', 'Remove…', 'Remove @carol?'],
    ]) {
      await pickRowAction(user, username, action);
      const confirm = await screen.findByRole('alertdialog', { name: dialog });
      await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    }
    // Nothing was sent: only the reads.
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method)).toEqual([]);
  });

  it("cancels a member's owner invite from their row, holding the row while it's on its way", async () => {
    openAt('?tab=people');
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'Actions for @dave' });
    let release!: () => void;
    heldCancel = new Promise<void>((resolve) => (release = resolve));

    await pickRowAction(user, 'dave', 'Cancel invite');
    await waitFor(() =>
      expect(requests('/api/wishlists/birthday/invites/inv-dave', 'DELETE')).toHaveLength(1)
    );
    // Held: the row's actions do nothing until it settles.
    const remove = await rowMenuItem(user, 'dave', 'Remove…');
    expect(remove).toHaveAttribute('aria-disabled', 'true');
    await user.keyboard('{Escape}');

    act(() => release());
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Invitation cancelled', 'success'));
    expect(captionOf('dave')).toBe('Member');
    expect(await rowMenuItems(user, 'dave')).toEqual(['Make owner…', 'Remove…']);
    expect(requests('/api/wishlists/birthday/invites/inv-dave', 'DELETE')).toHaveLength(1);
  });

  it('cancels an invite from the Invited row', async () => {
    openAt('?tab=people');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Cancel the invite to @erin' }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Invitation cancelled', 'success'));
    expect(requests('/api/wishlists/birthday/invites/inv-erin', 'DELETE')).toHaveLength(1);
    expect(within(peoplePanel()).queryByRole('link', { name: '@erin' })).toBeNull();
  });

  it("says when the people couldn't be read, with no count and no empty claim, and reads them again", async () => {
    membersFail = true;
    openAt('?tab=people');
    const user = userEvent.setup();
    expect(
      await screen.findByRole('heading', { name: 'Couldn’t load the people on this list' })
    ).toBeInTheDocument();
    expect(screen.queryByText(NO_MEMBERS_TEXT)).toBeNull();
    expect(screen.getAllByRole('tab')[1]).toHaveTextContent(/^People$/);

    membersFail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('button', { name: 'Actions for @bob' });
    expect(screen.getAllByRole('tab')[1]).toHaveTextContent('People4');
  });
});
