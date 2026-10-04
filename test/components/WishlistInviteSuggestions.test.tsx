// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { router, showToast } = vi.hoisted(() => ({
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

vi.mock('@/components/AppHeader', () => ({ default: () => null }));
vi.mock('@/components/AuthButton', () => ({ default: () => null }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));

import WishlistDetail from '@/app/wishlists/[id]/page';
import { openListTab } from './listMenu';

// User ids double as usernames. Alice (signed in) and Bob own the list, Carol
// is a member, and Dave has an invite pending.
const reply = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
});
const person = (id: string) => ({ _id: id, username: id, image: null });

const fetchMock = vi.fn();
const requests = (url: string, method: string) =>
  fetchMock.mock.calls.filter(([u, init]) => u === url && (init?.method ?? 'GET') === method);

beforeEach(() => {
  fetchMock.mockReset();
  showToast.mockReset();
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
          owners: ['alice', 'bob'],
          ownerUsernames: ['alice', 'bob'],
          userRole: 'owner',
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
          { _id: 'alice', user: person('alice'), role: 'owner' },
          { _id: 'bob', user: person('bob'), role: 'owner' },
          { _id: 'm-carol', user: person('carol'), role: 'member' },
        ],
      });
    }
    if (url === '/api/wishlists/birthday/invites' && method === 'GET') {
      return reply({
        success: true,
        data: [{ _id: 'i-dave', role: 'member', username: 'dave', image: null }],
      });
    }
    if (url.startsWith('/api/search?')) {
      return reply({
        success: true,
        data: { users: ['bob', 'carol', 'dave', 'erin'].map(person), wishlists: [] },
      });
    }
    if (url === '/api/wishlists/birthday/owners/carol' && method === 'POST') {
      return reply({ success: true, data: {} });
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

async function searchFor(user: ReturnType<typeof userEvent.setup>, text: string) {
  await openListTab(user, 'People');
  // The page has the people on the list before anyone searches.
  await screen.findByRole('link', { name: '@carol' });
  await screen.findByRole('link', { name: '@dave' });
  const field = screen.getByRole('combobox', { name: 'Search by username' });
  await user.click(field);
  await user.keyboard(text);
  await screen.findByRole('option', { name: '@erin' });
  return field;
}

describe('Invite suggestions on the wishlist page', () => {
  it('shows who is on the list already, from what the page has loaded', async () => {
    const user = userEvent.setup();
    render(<WishlistDetail />);
    await searchFor(user, 'xyz');

    expect(screen.getByRole('option', { name: '@bob' })).toHaveAccessibleDescription('Owner');
    expect(screen.getByRole('option', { name: '@carol' })).toHaveAccessibleDescription('Member');
    expect(screen.getByRole('option', { name: '@dave' })).toHaveAccessibleDescription('Invited');
    expect(screen.getByRole('option', { name: '@erin' })).not.toHaveAttribute('aria-disabled');
    // Worked out in the browser: the only search is the people search.
    expect(fetchMock.mock.calls.filter(([u]) => String(u).startsWith('/api/search'))).toHaveLength(
      1
    );
  });

  it("makes a member a co-owner through Make owner's confirmation and promotion invite", async () => {
    const user = userEvent.setup();
    render(<WishlistDetail />);
    const field = await searchFor(user, 'xyz');

    await user.click(screen.getByRole('option', { name: 'Make co-owner instead, @carol' }));

    const dialog = await screen.findByRole('alertdialog', { name: 'Make owner?' });
    expect(dialog).toHaveTextContent('@carol will get the same full control you have');
    expect(dialog).toHaveTextContent('They have to accept the invitation first');
    // Nothing is sent until it's confirmed.
    expect(requests('/api/wishlists/birthday/owners/carol', 'POST')).toHaveLength(0);

    await user.click(within(dialog).getByRole('button', { name: 'Send owner invite' }));

    await waitFor(() =>
      expect(requests('/api/wishlists/birthday/owners/carol', 'POST')).toHaveLength(1)
    );
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(showToast).toHaveBeenCalledWith(
      'Invitation sent — @carol becomes an owner once they accept',
      'success'
    );
    // Never the members invite, and never a role write.
    expect(requests('/api/wishlists/birthday/members', 'POST')).toHaveLength(0);
    expect(requests('/api/wishlists/birthday/owners/carol', 'PATCH')).toHaveLength(0);
    await waitFor(() => expect(field).toHaveFocus());
    // Focus coming back doesn't pop the suggestions open again.
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('sends nothing when the confirmation is cancelled', async () => {
    const user = userEvent.setup();
    render(<WishlistDetail />);
    await searchFor(user, 'xyz');

    await user.click(screen.getByRole('option', { name: 'Make co-owner instead, @carol' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Make owner?' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(requests('/api/wishlists/birthday/owners/carol', 'POST')).toHaveLength(0);
  });
});
