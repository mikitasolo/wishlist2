// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
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
import { REVOKE_LINKS_TITLE } from '@/components/RevokeShareLinksDialog';
import { KICK_LINKS_SENTENCE } from '@/lib/utils/confirmationCopy';
import { openListTab, pickRowAction } from './listMenu';

/**
 * What People says about share links when someone leaves the list's people
 * (WIS-338): a kick's confirmation says they can't use the links (only when
 * some work), and taking a co-owner off (Remove, or Make member) is followed
 * by the offer to revoke the live links they could have copied.
 */

interface LinkRow {
  _id: string;
  level: 'view' | 'join';
  label: string | null;
  expiresAt: string | null;
  createdAt: string;
  state: 'live' | 'expired';
  joinedCount: number;
  token: string;
}

let server: { owners: string[]; members: string[]; links: LinkRow[]; refuseOwners?: boolean };

const link = (over: Partial<LinkRow>): LinkRow => ({
  _id: 'l1',
  level: 'view',
  label: null,
  expiresAt: null,
  createdAt: '2026-10-01T00:00:00Z',
  state: 'live',
  joinedCount: 0,
  token: 'A'.repeat(22),
  ...over,
});

const reply = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
});

const person = (id: string) => ({ _id: id, username: id, image: null });
const fetchMock = vi.fn();

beforeAll(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterAll(() => vi.restoreAllMocks());

beforeEach(() => {
  fetchMock.mockReset();
  showToast.mockClear();
  server = { owners: ['alice', 'bob'], members: ['carol'], links: [] };
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
          owners: [...server.owners],
          visibility: 'private',
          archived: false,
          featured: false,
          currency: 'EUR',
          bannerUrl: null,
          occasion: null,
          userRole: 'owner',
          ownerUsernames: [...server.owners],
        },
      });
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
    if (url === '/api/wishlists/birthday/links' && method === 'GET') {
      return reply({ success: true, data: server.links });
    }
    const linkId = /^\/api\/wishlists\/birthday\/links\/([^/]+)$/.exec(url)?.[1];
    if (linkId && method === 'DELETE') {
      server.links = server.links.filter((l) => l._id !== linkId);
      return reply({ success: true, data: {} });
    }
    const memberId = /^\/api\/wishlists\/birthday\/members\/m-([^/]+)$/.exec(url)?.[1];
    if (memberId && method === 'DELETE') {
      server.members = server.members.filter((id) => id !== memberId);
      return reply({ success: true, data: {} });
    }
    const owner = /^\/api\/wishlists\/birthday\/owners\/([^/]+)$/.exec(url)?.[1];
    if (owner && (method === 'PATCH' || method === 'DELETE')) {
      if (server.refuseOwners) {
        return reply({ success: false, error: 'This person is not an owner' }, 404);
      }
      server.owners = server.owners.filter((id) => id !== owner);
      if (method === 'PATCH') {
        server.members = [owner, ...server.members];
        return reply({ success: true, data: { role: 'member', user: person(owner) } });
      }
      return reply({ success: true, data: {} });
    }
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

/** Open People, once its rows and the share links have been read. */
async function openPeople() {
  const user = userEvent.setup();
  render(<WishlistDetail />);
  await openListTab(user, 'People');
  await screen.findByRole('button', { name: 'Actions for @bob' });
  await waitFor(() =>
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/wishlists/birthday/links')).toBe(true)
  );
  // The section has drawn what it read.
  await screen.findByText(
    server.links.length ? server.links[0].label || 'Untitled link' : /No share links yet/
  );
  return user;
}

const LIVE = [
  link({ _id: 'family', label: 'Family chat', level: 'join', joinedCount: 2 }),
  link({ _id: 'qr', label: 'Wedding QR', token: 'B'.repeat(22) }),
];

describe('kicking a member', () => {
  it('says they can’t use the share links when the list has live ones', async () => {
    server.links = LIVE;
    const user = await openPeople();
    await pickRowAction(user, 'carol', 'Remove');
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove @carol?' });
    expect(dialog).toHaveTextContent(KICK_LINKS_SENTENCE);
    // Never who did it.
    expect(dialog).not.toHaveTextContent('@alice');
  });

  it('says nothing about links when the list has none that work', async () => {
    server.links = [
      link({ _id: 'old', label: 'Old QR', state: 'expired', expiresAt: '2026-01-01T00:00:00Z' }),
    ];
    const user = await openPeople();
    await pickRowAction(user, 'carol', 'Remove');
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove @carol?' });
    expect(dialog).not.toHaveTextContent(KICK_LINKS_SENTENCE);
  });

  it('is followed by no revoke prompt', async () => {
    server.links = LIVE;
    const user = await openPeople();
    await pickRowAction(user, 'carol', 'Remove');
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove @carol?' });
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.queryByRole('dialog', { name: REVOKE_LINKS_TITLE })).not.toBeInTheDocument();
  });
});

describe('taking a co-owner off the list', () => {
  it('offers to revoke the live links after Remove, and revokes the one picked', async () => {
    server.links = [
      ...LIVE,
      link({ _id: 'old', label: 'Old QR', state: 'expired', expiresAt: '2026-01-01T00:00:00Z' }),
    ];
    const user = await openPeople();
    await pickRowAction(user, 'bob', 'Remove');
    const confirm = await screen.findByRole('alertdialog', { name: 'Remove @bob as an owner?' });
    await user.click(within(confirm).getByRole('button', { name: 'Remove' }));

    const prompt = await screen.findByRole('dialog', { name: REVOKE_LINKS_TITLE });
    // Only once the confirmation has closed, never stacked on it.
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(prompt).toHaveTextContent("@bob could copy this list's share links.");
    const rows = within(within(prompt).getByRole('list', { name: 'Share links' })).getAllByRole(
      'listitem'
    );
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Family chat'),
      expect.stringContaining('Wedding QR'),
    ]);
    expect(rows[0]).toHaveTextContent('2 people joined');

    await user.click(within(prompt).getByRole('button', { name: 'Revoke Family chat' }));
    await waitFor(() =>
      expect(
        within(prompt).queryByRole('button', { name: 'Revoke Family chat' })
      ).not.toBeInTheDocument()
    );
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) => /\/links\//.test(url) && (init as RequestInit)?.method === 'DELETE'
      )
    ).toEqual([['/api/wishlists/birthday/links/family', { method: 'DELETE' }]]);
    expect(server.links.map((l) => l._id)).toEqual(['qr', 'old']);

    await user.click(within(prompt).getByRole('button', { name: 'Done' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: REVOKE_LINKS_TITLE })).not.toBeInTheDocument()
    );
    // The other links stay.
    expect(server.links.map((l) => l._id)).toEqual(['qr', 'old']);
  });

  it('offers it after Make member too', async () => {
    server.links = LIVE;
    const user = await openPeople();
    await pickRowAction(user, 'bob', 'Make member');
    const confirm = await screen.findByRole('alertdialog', { name: 'Make @bob a member?' });
    await user.click(within(confirm).getByRole('button', { name: 'Make member' }));
    expect(await screen.findByRole('dialog', { name: REVOKE_LINKS_TITLE })).toBeInTheDocument();
  });

  it('offers nothing when the list has no live links', async () => {
    server.links = [
      link({ _id: 'old', label: 'Old QR', state: 'expired', expiresAt: '2026-01-01T00:00:00Z' }),
    ];
    const user = await openPeople();
    await pickRowAction(user, 'bob', 'Remove');
    const confirm = await screen.findByRole('alertdialog', { name: 'Remove @bob as an owner?' });
    await user.click(within(confirm).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Owner removed', 'success'));
    expect(screen.queryByRole('dialog', { name: REVOKE_LINKS_TITLE })).not.toBeInTheDocument();
  });

  it('offers nothing when the removal was refused', async () => {
    server.links = LIVE;
    const user = await openPeople();
    server.refuseOwners = true;
    await pickRowAction(user, 'bob', 'Remove');
    const confirm = await screen.findByRole('alertdialog', { name: 'Remove @bob as an owner?' });
    await user.click(within(confirm).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(showToast).toHaveBeenCalledWith('This person is not an owner', 'error');
    expect(screen.queryByRole('dialog', { name: REVOKE_LINKS_TITLE })).not.toBeInTheDocument();
  });
});
