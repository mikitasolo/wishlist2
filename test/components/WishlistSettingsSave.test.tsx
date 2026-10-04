// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { push, replace, showToast } = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { user: { id: 'alice', username: 'alice' } },
    status: 'authenticated',
  }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
  useParams: () => ({ id: 'birthday' }),
}));

// The header has its own fetches and tests; this file is about the settings form.
vi.mock('@/components/AppHeader', () => ({ default: () => null }));
vi.mock('@/components/AuthButton', () => ({ default: () => null }));

vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));

import WishlistDetail from '@/app/wishlists/[id]/page';
import { openListTab } from './listMenu';

// The list as Alice's page loads it: she and Bob own it.
const loaded = {
  _id: 'birthday',
  name: 'Birthday',
  slug: 'birthday',
  description: 'Things I would like',
  owners: ['alice', 'bob'],
  visibility: 'everyone',
  archived: false,
  featured: false,
  currency: 'EUR',
  bannerUrl: null,
  occasion: null,
};

const reply = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
});

/** The bodies of the settings PATCHes the page sent, in order. */
let patches: Record<string, unknown>[];
/** The list as the server has it: Bob's changes land here. */
let server: typeof loaded & Record<string, unknown>;

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  patches = [];
  server = { ...loaded };
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url === '/api/wishlists/birthday' && method === 'GET') {
      return reply({
        success: true,
        data: { ...server, userRole: 'owner', ownerUsernames: ['alice', 'bob'] },
      });
    }
    if (url === '/api/wishlists/birthday' && method === 'PATCH') {
      // The server's one write: the fields sent, over the list as it is now.
      const body = JSON.parse(String(init?.body));
      patches.push(body);
      server = { ...server, ...body };
      return reply({ success: true, data: server });
    }
    if (url === '/api/wishlists/birthday/items') return reply({ success: true, data: [] });
    if (url.startsWith('/api/wishlists/birthday/')) return reply({ success: true, data: [] });
    return reply({ success: false, error: 'Not mocked' }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function openSettings() {
  const user = userEvent.setup();
  render(<WishlistDetail />);
  await openListTab(user, 'Settings');
  await screen.findByRole('heading', { name: 'About' });
  return user;
}

const description = () => screen.getByLabelText('Description');
const save = () => screen.getByRole('button', { name: 'Save' });
/** The bar that says there's something to save, with Discard and Save. */
const saveBar = () => screen.queryByText('Unsaved changes')?.parentElement ?? null;

describe('the wishlist settings form', () => {
  // regression: the form sent every setting on each save, as filled when the
  // page loaded, so a description edit wrote back the visibility the list had
  // then, undoing a co-owner who had made it private in the meantime.
  it('regression: a description-only save sends only the description, leaving a co-owner’s visibility change alone', async () => {
    const user = await openSettings();
    // Bob makes the list private while Alice's form is open.
    server = { ...server, visibility: 'private' };

    await user.clear(description());
    await user.type(description(), 'Updated');
    await user.click(save());

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({ description: 'Updated' });
    expect(server.visibility).toBe('private');
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('Wishlist updated successfully', 'success')
    );
  });

  it("refills the form from the list as saved, so the next save doesn't send a co-owner's change back", async () => {
    const user = await openSettings();
    server = { ...server, visibility: 'private' };

    await user.type(description(), '!');
    await user.click(save());
    await waitFor(() => expect(patches).toHaveLength(1));

    // The form now shows Bob's visibility, not the one it loaded.
    expect(
      await screen.findByText('Only owners and people you invite can open it.')
    ).toBeInTheDocument();

    const name = screen.getByLabelText('Wishlist name *');
    await user.clear(name);
    await user.type(name, 'Turning 37');
    await user.click(save());

    await waitFor(() => expect(patches).toHaveLength(2));
    expect(patches[1]).toEqual({ name: 'Turning 37' });
    expect(server).toMatchObject({ name: 'Turning 37', visibility: 'private' });
  });

  it('sends the settings that were changed together', async () => {
    const user = await openSettings();

    await user.click(screen.getByRole('radio', { name: /Friends/ }));
    await user.clear(description());
    await user.click(save());

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({ description: '', visibility: 'friends' });
  });

  // regression: Save was always there, and pressing it with nothing changed
  // toasted "No changes to save".
  it('regression: offers no Save while nothing was changed, and Enter sends nothing', async () => {
    const user = await openSettings();
    expect(saveBar()).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();

    // Typed and put back: the form is as it was loaded, so the bar goes again.
    await user.type(description(), '!');
    expect(saveBar()).not.toBeNull();
    await user.type(description(), '{Backspace}');
    expect(saveBar()).toBeNull();
    // A change only in case or spaces isn't one either: the server stores it as it is.
    await user.type(screen.getByLabelText('Wishlist name *'), ' {Enter}');
    expect(saveBar()).toBeNull();

    expect(showToast).not.toHaveBeenCalled();
    expect(patches).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/wishlists/birthday',
      expect.objectContaining({ method: 'PATCH' })
    );
  });

  it('keeps the edits after a failed save, and sends them again on the next one', async () => {
    const user = await openSettings();
    const succeed = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
      init?.method === 'PATCH'
        ? reply({ success: false, error: 'Failed to update wishlist' }, 500)
        : succeed(url, init)
    );

    await user.clear(description());
    await user.type(description(), 'Updated');
    await user.click(save());
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('Failed to update wishlist', 'error')
    );
    expect(description()).toHaveValue('Updated');

    fetchMock.mockImplementation(succeed);
    await user.click(save());
    await waitFor(() => expect(patches).toEqual([{ description: 'Updated' }]));
  });

  it('shows the save bar only while the form differs from the list, and Discard puts the form back', async () => {
    const user = await openSettings();
    expect(saveBar()).toBeNull();

    await user.clear(description());
    await user.type(description(), 'Something else');
    await user.click(screen.getByRole('radio', { name: /Friends/ }));
    const bar = saveBar()!;
    expect(bar).not.toBeNull();
    expect(
      within(bar)
        .getAllByRole('button')
        .map((b) => b.textContent)
    ).toEqual(['Discard', 'Save']);

    await user.click(within(bar).getByRole('button', { name: 'Discard' }));
    expect(saveBar()).toBeNull();
    expect(description()).toHaveValue('Things I would like');
    expect(screen.getByRole('radio', { name: /Public/ })).toBeChecked();
    expect(patches).toEqual([]);
  });

  it('hides the bar once a save lands, and warns while the link is changed', async () => {
    const user = await openSettings();
    const link = screen.getByLabelText('Link');
    expect(screen.queryByText("Changing it breaks links you've already shared.")).toBeNull();

    await user.clear(link);
    await user.type(link, 'turning-37');
    expect(screen.getByText("Changing it breaks links you've already shared.")).toBeInTheDocument();
    await user.click(save());

    await waitFor(() => expect(patches).toEqual([{ slug: 'turning-37' }]));
    await waitFor(() => expect(saveBar()).toBeNull());
    expect(screen.queryByText("Changing it breaks links you've already shared.")).toBeNull();
    // The page follows the list to its new link, on the tab it's on.
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/wishlists/turning-37?tab=settings'));
  });
});
