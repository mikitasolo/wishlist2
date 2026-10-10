// @vitest-environment jsdom
// The wishlist page's header actions for each kind of viewer, and Pin to my
// dashboard, which toggles only the caller's own pin (`featuredBy`).
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { listMenuItems, listTab, openListTab, pickFromListMenu } from './listMenu';

const { router, showToast, auth } = vi.hoisted(() => ({
  // One object, as Next's own router is: the page's read of the list depends on it.
  router: { push: vi.fn(), replace: vi.fn() },
  showToast: vi.fn(),
  auth: {
    session: { data: null, status: 'unauthenticated' } as {
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
// The app header has its own fetches and tests; this file is about the list's.
vi.mock('@/components/AppHeader', () => ({ default: () => null }));
vi.mock('@/components/AuthButton', () => ({ default: () => null }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));

import WishlistDetail from '@/app/wishlists/[id]/page';

/** What the list read answers the signed-in viewer (or no one). */
let list: {
  owners: string[];
  userRole: 'owner' | 'member' | null;
  featured: boolean;
  bannerUrl?: string | null;
  description?: string;
};
/** Makes the next pin or unpin fail. */
let failPin: boolean;

const reply = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
});

const fetchMock = vi.fn();
/** The edits the page sent to the list. */
const listPatches = () =>
  fetchMock.mock.calls
    .filter(([url, init]) => url === '/api/wishlists/birthday' && init?.method === 'PATCH')
    .map(([, init]) => JSON.parse(String(init.body)));

beforeAll(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterAll(() => vi.restoreAllMocks());

beforeEach(() => {
  fetchMock.mockReset();
  showToast.mockReset();
  list = { owners: ['alice'], userRole: 'owner', featured: false };
  failPin = false;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url === '/api/wishlists/birthday' && method === 'GET') {
      return reply({
        success: true,
        data: {
          _id: 'birthday',
          name: 'Birthday',
          slug: 'birthday',
          description: list.description ?? '',
          owners: [...list.owners],
          ownerUsernames: [...list.owners],
          userRole: list.userRole,
          visibility: 'everyone',
          archived: false,
          featured: list.featured,
          currency: 'EUR',
          bannerUrl: list.bannerUrl ?? null,
          occasion: null,
        },
      });
    }
    if (url === '/api/wishlists/birthday' && method === 'PATCH') {
      if (failPin) return reply({ success: false, error: 'Failed to update wishlist' }, 500);
      const { featured } = JSON.parse(String(init?.body));
      list.featured = featured;
      return reply({ success: true, data: { _id: 'birthday', featured } });
    }
    // Items, members, invites, rates.
    if (method === 'GET') return reply({ success: true, data: [] });
    return reply({ success: false, error: 'Not mocked' }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function signIn(id: string | null) {
  auth.session = id
    ? { data: { user: { id, username: id } }, status: 'authenticated' }
    : { data: null, status: 'unauthenticated' };
}

/** The header's row of actions, by accessible name, once the list is on screen. */
async function actionRow() {
  const row = await screen.findByRole('group', { name: 'List actions' });
  return within(row)
    .getAllByRole('button')
    .map((b) => b.getAttribute('aria-label') ?? b.textContent);
}

describe('the header’s actions for each viewer', () => {
  it.each([
    {
      who: 'the sole owner',
      viewer: 'alice',
      owners: ['alice'],
      role: 'owner' as const,
      row: ['Add item', 'Share', 'More list actions'],
      menu: ['Pin to my dashboard', 'Leave list'],
    },
    {
      who: 'a co-owner',
      viewer: 'alice',
      owners: ['bob', 'alice'],
      role: 'owner' as const,
      row: ['Add item', 'Share', 'More list actions'],
      menu: ['Pin to my dashboard', 'Leave list'],
    },
    {
      who: 'a member',
      viewer: 'carol',
      owners: ['alice'],
      role: 'member' as const,
      row: ['Propose', 'Share', 'More list actions'],
      menu: ['Leave list'],
    },
    {
      who: 'a signed-in visitor',
      viewer: 'dave',
      owners: ['alice'],
      role: null,
      row: ['Share'],
      menu: [],
    },
    {
      who: 'a signed-out visitor',
      viewer: null,
      owners: ['alice'],
      role: null,
      row: ['Share'],
      menu: [],
    },
  ])('gives $who $row, and ⋯ $menu', async ({ viewer, owners, role, row, menu }) => {
    signIn(viewer);
    list = { owners, userRole: role, featured: false };
    const user = userEvent.setup();
    render(<WishlistDetail />);

    expect(await actionRow()).toEqual(row);
    expect(await listMenuItems(user)).toEqual(menu);
    // Leave is never a button of its own: it's Leave list, in the menu.
    expect(screen.queryByRole('button', { name: /^Leave/ })).toBeNull();
  });

  it('opens the add dialog from Add item, and the proposal dialog from Propose', async () => {
    signIn('alice');
    const user = userEvent.setup();
    const { unmount } = render(<WishlistDetail />);
    await user.click(await screen.findByRole('button', { name: 'Add item' }));
    expect(await screen.findByRole('dialog', { name: 'Add new item' })).toBeInTheDocument();
    unmount();

    signIn('carol');
    list = { owners: ['alice'], userRole: 'member', featured: false };
    render(<WishlistDetail />);
    await user.click(await screen.findByRole('button', { name: 'Propose' }));
    expect(await screen.findByRole('dialog', { name: 'Propose new item' })).toBeInTheDocument();
  });
});

describe('Pin to my dashboard', () => {
  beforeEach(() => signIn('alice'));

  it('pins the list for the caller alone, then offers to unpin it', async () => {
    list = { owners: ['bob', 'alice'], userRole: 'owner', featured: false };
    const user = userEvent.setup();
    render(<WishlistDetail />);
    await actionRow();

    await pickFromListMenu(user, 'Pin to my dashboard');

    await waitFor(() => expect(listPatches()).toEqual([{ featured: true }]));
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('Pinned to your dashboard', 'success')
    );
    expect(await listMenuItems(user)).toEqual(['Unpin from my dashboard', 'Leave list']);

    await pickFromListMenu(user, 'Unpin from my dashboard');
    await waitFor(() => expect(listPatches()).toEqual([{ featured: true }, { featured: false }]));
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('Unpinned from your dashboard', 'success')
    );
    expect(await listMenuItems(user)).toEqual(['Pin to my dashboard', 'Leave list']);
  });

  it('starts from the caller’s own pin, as the list read gives it', async () => {
    list = { owners: ['alice'], userRole: 'owner', featured: true };
    const user = userEvent.setup();
    render(<WishlistDetail />);
    await actionRow();
    expect(await listMenuItems(user)).toEqual(['Unpin from my dashboard', 'Leave list']);
  });

  it('keeps the pin as it was when the request fails', async () => {
    const user = userEvent.setup();
    render(<WishlistDetail />);
    await actionRow();
    failPin = true;

    await pickFromListMenu(user, 'Pin to my dashboard');

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('Failed to update wishlist', 'error')
    );
    expect(await listMenuItems(user)).toEqual(['Pin to my dashboard', 'Leave list']);
  });

  it('is no longer a section of the settings form', async () => {
    const user = userEvent.setup();
    render(<WishlistDetail />);
    await openListTab(user, 'Settings');
    await screen.findByRole('heading', { name: 'About' });
    expect(screen.queryByText(/Feature/)).toBeNull();
    expect(screen.queryByRole('button', { name: /feature/i })).toBeNull();
  });
});

describe('the cover strip and the description', () => {
  const BANNER = 'https://teststore42.public.blob.vercel-storage.com/uploads/alice/banner.webp';
  const openList = () => {
    render(<WishlistDetail />);
    return screen.findByRole('heading', { level: 1, name: 'Birthday' });
  };
  const follows = (a: Node, b: Node) =>
    !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

  // A list with no banner used to get a 16:9 gradient block under its title,
  // which said nothing and pushed the items down.
  it('shows no cover at all on a list without a banner', async () => {
    signIn('alice');
    await openList();
    expect(screen.getByRole('main').querySelector('img')).toBeNull();
  });

  it('puts the banner above the title, and keeps it there on every tab', async () => {
    signIn('alice');
    list.bannerUrl = BANNER;
    const h1 = await openList();
    const banner = () => screen.getByRole('main').querySelector('img')!;
    expect(banner().getAttribute('src')).toContain(encodeURIComponent(BANNER));
    expect(follows(banner(), h1)).toBe(true);

    const user = userEvent.setup();
    for (const tab of ['People', 'Settings'] as const) {
      await openListTab(user, tab);
      expect(await listTab(tab)).toHaveAttribute('aria-selected', 'true');
      expect(follows(banner(), screen.getByRole('heading', { level: 1 }))).toBe(true);
    }
  });

  it('shows the description as plain text under the title, for every viewer', async () => {
    signIn(null);
    list.userRole = null;
    list.description = 'Turning 30 at the lake.';
    const h1 = await openList();
    const text = screen.getByText('Turning 30 at the lake.');
    expect(text.tagName).toBe('P');
    expect(follows(h1, text)).toBe(true);
    expect(text.parentElement).toHaveClass('sm:line-clamp-3');
  });
});
