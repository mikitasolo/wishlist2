// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
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

// The list as Alice's page loads it: she and Bob own it.
const loaded = {
  _id: 'w1',
  name: 'Birthday',
  slug: 'birthday',
  description: 'Things I would like',
  owners: ['alice', 'bob'],
  visibility: 'everyone',
  isPublic: true,
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
  await user.click(await screen.findByRole('button', { name: 'Manage wishlist' }));
  await screen.findByText('Wishlist settings');
  return user;
}

const description = () => screen.getByLabelText('Description');
const save = () => screen.getByRole('button', { name: 'Save changes' });

describe('the wishlist settings form', () => {
  // regression: the form sent every setting on each save, as filled when the
  // page loaded, so a description edit wrote back the visibility the list had
  // then, undoing a co-owner who had made it private in the meantime.
  it('regression: a description-only save sends only the description, leaving a co-owner’s visibility change alone', async () => {
    const user = await openSettings();
    // Bob makes the list private while Alice's form is open.
    server = { ...server, visibility: 'private', isPublic: false };

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
    server = { ...server, visibility: 'private', isPublic: false };

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

  it('sends nothing when nothing was changed, and says so', async () => {
    const user = await openSettings();

    // Typed and put back: the form is as it was loaded.
    await user.type(description(), '!');
    await user.type(description(), '{Backspace}');
    await user.click(save());

    expect(showToast).toHaveBeenCalledWith('No changes to save', 'info');
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
});
