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

// The header has its own fetches and tests; this file is about archiving.
vi.mock('@/components/AppHeader', () => ({ default: () => null }));
vi.mock('@/components/AuthButton', () => ({ default: () => null }));

vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));

import WishlistDetail from '@/app/wishlists/[id]/page';

const ARCHIVE_EXPLANATION =
  "Only owners can open it. Members and anyone with the link will see that it isn't available. Items and reservations are kept, and you can unarchive anytime.";
const BANNER_TEXT = 'Archived. Only owners can see this list.';

// The list as the server has it. Alice, signed in, is its only owner.
let archived: boolean;
// Whether the server refuses the next archive or unarchive.
let refuse: boolean;

const reply = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
});

const list = () => ({
  _id: 'w1',
  name: 'Birthday',
  slug: 'birthday',
  description: '',
  owners: ['alice'],
  ownerUsernames: ['alice'],
  userRole: 'owner',
  visibility: 'everyone',
  isPublic: true,
  archived,
  featured: false,
  currency: 'EUR',
  bannerUrl: null,
  occasion: null,
});

const fetchMock = vi.fn();
/** The bodies of the writes to the list itself (archive, unarchive). */
const listWrites = () =>
  fetchMock.mock.calls
    .filter(([url, init]) => url === '/api/wishlists/birthday' && init?.method === 'PATCH')
    .map(([, init]) => JSON.parse(init.body));

// jsdom has no scrollTo, which the dialog's scroll lock puts the page back with on close.
beforeAll(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterAll(() => vi.restoreAllMocks());

beforeEach(() => {
  fetchMock.mockReset();
  showToast.mockReset();
  archived = false;
  refuse = false;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url === '/api/wishlists/birthday' && method === 'GET') {
      return reply({ success: true, data: list() });
    }
    if (url === '/api/wishlists/birthday' && method === 'PATCH') {
      if (refuse) return reply({ success: false, error: 'Failed to update wishlist' }, 500);
      archived = JSON.parse(String(init?.body)).archived;
      return reply({ success: true, data: list() });
    }
    if (url === '/api/wishlists/birthday/members' && method === 'GET') {
      return reply({
        success: true,
        data: [{ _id: 'alice', user: { _id: 'alice', username: 'alice' }, role: 'owner' }],
      });
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
});

/** Every Share on the page: the header's, and the empty list's own (this list has no items). */
const shareButtons = () => screen.queryAllByRole('button', { name: 'Copy link to share' });
const banner = () => screen.queryByText(BANNER_TEXT)?.parentElement ?? null;
/** The pill on the list's cover. */
const coverPill = (label: string) => screen.queryByText(label, { selector: 'span' });

/** Open Manage and wait for its Archive section. Returns that section's button. */
async function openManage(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Manage wishlist' }));
  const heading = await screen.findByRole('heading', { name: /^(Archive|Unarchive) wishlist$/ });
  return within(heading.parentElement!).getByRole('button');
}

describe('Archiving a list', () => {
  it('explains what archiving does where it is offered', async () => {
    const user = userEvent.setup();
    render(<WishlistDetail />);
    const archive = await openManage(user);

    expect(archive).toHaveTextContent('Archive');
    expect(archive.parentElement).toHaveTextContent(ARCHIVE_EXPLANATION);
    // Not the old copy, which made it sound like tidying the dashboard.
    expect(document.body).not.toHaveTextContent(/top of your dashboard without deleting/);
  });

  // regression: Archive applied on one click, though it shuts every member and
  // visitor out of the list and breaks every link already shared.
  it('regression: asks for confirmation first, and archives nothing on Cancel', async () => {
    const user = userEvent.setup();
    render(<WishlistDetail />);
    const archive = await openManage(user);

    await user.click(archive);

    const dialog = await screen.findByRole('alertdialog', { name: 'Archive wishlist?' });
    expect(dialog).toHaveAccessibleDescription(ARCHIVE_EXPLANATION);
    expect(
      within(dialog)
        .getAllByRole('button')
        .map((b) => b.textContent)
    ).toEqual(['Cancel', 'Archive']);
    expect(listWrites()).toEqual([]);

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(listWrites()).toEqual([]);
    expect(screen.getByRole('heading', { name: 'Archive wishlist' })).toBeInTheDocument();
    await waitFor(() => expect(archive).toHaveFocus());
  });

  it('archives once confirmed, and then shows the list as archived', async () => {
    const user = userEvent.setup();
    render(<WishlistDetail />);
    const archive = await openManage(user);

    await user.click(archive);
    const dialog = await screen.findByRole('alertdialog', { name: 'Archive wishlist?' });
    await user.click(within(dialog).getByRole('button', { name: 'Archive' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(listWrites()).toEqual([{ archived: true }]);
    expect(showToast).toHaveBeenCalledWith('Wishlist archived', 'success');
    expect(await screen.findByRole('heading', { name: 'Unarchive wishlist' })).toBeInTheDocument();

    // Back on the items: the banner, the Archived pill, and no Share.
    await user.click(screen.getAllByRole('button', { name: 'Back to items' })[0]);
    expect(await screen.findByText(BANNER_TEXT)).toBeInTheDocument();
    expect(coverPill('Archived')).toBeInTheDocument();
    expect(coverPill('Public')).toBeNull();
    expect(shareButtons()).toEqual([]);
  });

  it('leaves the list as it was when the server refuses the archive', async () => {
    refuse = true;
    const user = userEvent.setup();
    render(<WishlistDetail />);
    await user.click(await openManage(user));
    const dialog = await screen.findByRole('alertdialog', { name: 'Archive wishlist?' });
    await user.click(within(dialog).getByRole('button', { name: 'Archive' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(showToast).toHaveBeenCalledWith('Failed to update wishlist', 'error');
    expect(screen.getByRole('heading', { name: 'Archive wishlist' })).toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: 'Back to items' })[0]);
    expect(await screen.findAllByRole('button', { name: 'Copy link to share' })).not.toHaveLength(
      0
    );
    expect(banner()).toBeNull();
    expect(coverPill('Public')).toBeInTheDocument();
  });
});

describe('An archived list, for its owner', () => {
  beforeEach(() => {
    archived = true;
  });

  // regression: nothing marked an archived list as archived. The cover pill
  // still read "Public" (it came from the visibility alone), and Share looked
  // as if the link would open for anyone.
  it('regression: shows the archived banner and the Archived pill, not Public, and no Share', async () => {
    render(<WishlistDetail />);

    expect(await screen.findByText(BANNER_TEXT)).toBeInTheDocument();
    expect(within(banner()!).getByRole('button', { name: 'Unarchive' })).toBeEnabled();
    expect(coverPill('Archived')).toBeInTheDocument();
    expect(coverPill('Public')).toBeNull();
    expect(shareButtons()).toEqual([]);
  });

  // regression: the only way back was the Unarchive buried in Manage.
  it('regression: unarchives from the banner, without asking first', async () => {
    const user = userEvent.setup();
    render(<WishlistDetail />);
    await screen.findByText(BANNER_TEXT);

    await user.click(within(banner()!).getByRole('button', { name: 'Unarchive' }));

    await waitFor(() => expect(screen.queryByText(BANNER_TEXT)).toBeNull());
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(listWrites()).toEqual([{ archived: false }]);
    expect(showToast).toHaveBeenCalledWith('Wishlist unarchived', 'success');
    expect(coverPill('Public')).toBeInTheDocument();
    expect(coverPill('Archived')).toBeNull();
    expect(shareButtons()).not.toHaveLength(0);
  });

  it('keeps the banner when the server refuses the unarchive', async () => {
    refuse = true;
    const user = userEvent.setup();
    render(<WishlistDetail />);
    await screen.findByText(BANNER_TEXT);

    await user.click(within(banner()!).getByRole('button', { name: 'Unarchive' }));

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('Failed to update wishlist', 'error')
    );
    expect(listWrites()).toEqual([{ archived: false }]);
    expect(within(banner()!).getByRole('button', { name: 'Unarchive' })).toBeEnabled();
    expect(coverPill('Archived')).toBeInTheDocument();
  });

  it('unarchives from Manage too, without asking first', async () => {
    const user = userEvent.setup();
    render(<WishlistDetail />);
    const unarchive = await openManage(user);
    expect(unarchive).toHaveTextContent('Unarchive');
    expect(unarchive.parentElement).toHaveTextContent(
      'This wishlist is archived: only owners can see it.'
    );

    await user.click(unarchive);

    expect(await screen.findByRole('heading', { name: 'Archive wishlist' })).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(listWrites()).toEqual([{ archived: false }]);
  });
});
