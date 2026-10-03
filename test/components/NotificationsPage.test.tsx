// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { NotificationView } from '@/lib/utils/notifications';

const { push, showToast, signedIn } = vi.hoisted(() => ({
  push: vi.fn(),
  showToast: vi.fn(),
  // Mutable, so a test can sign another account in while the page is open.
  signedIn: { id: 'u1', username: 'me' },
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { ...signedIn } }, status: 'authenticated' }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
// The header has its own fetches and tests; this file is about the feed rows.
vi.mock('@/components/AppHeader', () => ({ default: () => null }));
vi.mock('@/components/AuthButton', () => ({ default: () => null }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));

import ActivityPage from '@/app/notifications/page';

function row(overrides: Partial<NotificationView>): NotificationView {
  return {
    _id: 'n1',
    type: 'follow',
    actorUsername: null,
    count: 1,
    actorUsernames: [],
    wishlistName: null,
    wishlistSlug: null,
    wishlistId: null,
    itemName: null,
    actorId: null,
    actorImage: null,
    followingActor: null,
    read: true,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

const json = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
});

/**
 * Serves the feed as `data`, no pending invites, and anything else a test
 * answers with `other` (a follow, the followers list).
 */
function serve(
  data: NotificationView[],
  other: (url: string, init?: RequestInit) => unknown = () => {
    throw new Error('unexpected fetch');
  }
) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/notifications?actors=1' && !init?.method) {
      return json({ success: true, data, unreadCount: 0 });
    }
    if (url === '/api/users/me/invites') return json({ success: true, data: [] });
    return other(url, init);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  push.mockReset();
  showToast.mockReset();
  signedIn.id = 'u1';
  signedIn.username = 'me';
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The deepest element whose text is the whole line, list name included. */
const line = (text: string) =>
  screen.findByText(
    (_, el) =>
      el?.textContent === text && Array.from(el.children).every((c) => c.textContent !== text)
  );

describe('Activity', () => {
  it('is titled Activity, with a one-line subtitle', async () => {
    serve([]);
    render(<ActivityPage />);
    expect(screen.getByRole('heading', { name: 'Activity', level: 1 })).toBeVisible();
    expect(screen.getByText('Updates about your lists and people you follow.')).toBeVisible();
    expect(await screen.findByText('You’re all caught up')).toBeInTheDocument();
  });

  it('links a demotion to the list, but leaves a removal unlinked', async () => {
    serve([
      row({
        _id: 'n-demoted',
        type: 'role_changed',
        wishlistName: 'Family list',
        wishlistSlug: 'family-list',
        wishlistId: 'w1',
      }),
      row({
        _id: 'n-removed',
        type: 'removed_from_wishlist',
        wishlistName: 'Book club',
        wishlistId: 'w2',
      }),
    ]);

    render(<ActivityPage />);

    const demoted = await line('You’re now a member of Family list');
    expect(demoted.closest('a')?.getAttribute('href')).toBe('/wishlists/family-list');

    // The list may be hidden from them now, so the row isn't a link at all.
    const removed = await line('You were removed from Book club');
    expect(removed.closest('a')).toBeNull();
    expect(removed.closest('li')).not.toBeNull();
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  // regression: some rows quoted the list's name and others didn't.
  it('regression: sets every list name in semibold, unquoted', async () => {
    serve([
      row({ _id: 'n1', type: 'proposal', count: 2, wishlistName: 'Kitchen', wishlistId: 'w1' }),
      row({ _id: 'n2', type: 'wishlist_invite', actorUsername: 'ben', wishlistName: 'Garden' }),
      row({ _id: 'n3', type: 'role_changed', wishlistName: 'Family list', wishlistId: 'w3' }),
    ]);

    render(<ActivityPage />);

    for (const [text, name] of [
      ['2 new proposals on Kitchen', 'Kitchen'],
      ['@ben invited you to Garden', 'Garden'],
      ['You’re now a member of Family list', 'Family list'],
    ]) {
      const el = await line(text);
      expect(within(el).getByText(name)).toHaveClass('font-semibold');
    }
    expect(document.body.textContent).not.toMatch(/[“”]/);
  });

  it('shows an answered invite as the answer, linking only an accepted one', async () => {
    serve([
      row({
        _id: 'n-joined',
        type: 'wishlist_invite',
        actorUsername: 'ben',
        wishlistName: 'Housewarming',
        wishlistId: 'w1',
        inviteAnswer: 'accepted',
      }),
      row({
        _id: 'n-declined',
        type: 'wishlist_invite',
        actorUsername: 'chloe',
        wishlistName: 'Garden',
        wishlistId: 'w2',
        inviteAnswer: 'declined',
      }),
    ]);

    render(<ActivityPage />);

    const joined = await line('You joined Housewarming');
    expect(joined.closest('a')?.getAttribute('href')).toBe('/wishlists/w1');
    const declined = await line('You declined the invite to Garden');
    expect(declined.closest('a')).toBeNull();
    expect(screen.queryByText(/invited you/)).toBeNull();
  });
});

describe('Activity — avatars', () => {
  const photo = (name: string) => `https://blob.example/${name}.jpg`;
  const leadingImage = async (text: string) =>
    (await line(text)).closest('li')!.querySelector('img')?.getAttribute('src') ?? null;

  it("shows the actor's photo on a follow, an invite and an accepted invite", async () => {
    serve([
      row({ _id: 'n1', type: 'follow', actorUsername: 'gus', actorImage: photo('gus') }),
      row({
        _id: 'n2',
        type: 'wishlist_invite',
        actorUsername: 'ben',
        actorImage: photo('ben'),
        wishlistName: 'Garden',
        inviteAnswer: 'accepted',
        wishlistId: 'w2',
      }),
      row({
        _id: 'n3',
        type: 'invite_accepted',
        actorUsername: 'ann',
        actorImage: photo('ann'),
        wishlistName: 'Kitchen',
        wishlistId: 'w3',
      }),
    ]);
    render(<ActivityPage />);

    expect(await leadingImage('@gus followed you')).toBe(photo('gus'));
    expect(await leadingImage('You joined Garden')).toBe(photo('ben'));
    expect(await leadingImage('@ann accepted your invitation to Kitchen')).toBe(photo('ann'));
  });

  // Proposals are anonymous to the owners, and a demotion or removal never says
  // which owner did it: even a row that somehow carried an actor shows its icon.
  it('never shows a face on a proposal, a demotion or a removal', async () => {
    const leak = { actorUsername: 'owner', actorImage: photo('owner'), actorId: 'u9' };
    serve([
      row({ _id: 'n1', type: 'proposal', wishlistName: 'Kitchen', wishlistId: 'w1', ...leak }),
      row({ _id: 'n2', type: 'role_changed', wishlistName: 'Family', wishlistId: 'w2', ...leak }),
      row({ _id: 'n3', type: 'removed_from_wishlist', wishlistName: 'Club', ...leak }),
      row({ _id: 'n4', type: 'proposal_approved', wishlistName: 'Trip', wishlistId: 'w4' }),
    ]);
    render(<ActivityPage />);

    for (const text of [
      'Someone proposed an item for Kitchen',
      'You’re now a member of Family',
      'You were removed from Club',
      'Your proposed item was accepted in Trip',
    ]) {
      const item = (await line(text)).closest('li')!;
      expect(item.querySelector('img'), text).toBeNull();
      expect(item.querySelector('svg'), text).not.toBeNull();
      expect(item.textContent, text).not.toContain('owner');
    }
  });
});

describe('Activity — follow rows', () => {
  it('offers Follow back on a follow from someone you don’t follow, and follows them', async () => {
    const fetchMock = serve(
      [
        row({
          _id: 'n1',
          type: 'follow',
          actorUsername: 'gus',
          actorId: 'u-gus',
          followingActor: false,
        }),
      ],
      (url, init) => {
        if (url === '/api/users/u-gus/follow' && init?.method === 'POST') {
          return json({ success: true });
        }
        throw new Error(`unexpected fetch ${url}`);
      }
    );
    render(<ActivityPage />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Follow back' }));

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/users/u-gus/follow',
      expect.objectContaining({ method: 'POST' })
    );
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Follow back' })).toBeNull());
    expect(showToast).toHaveBeenCalledWith('You’re now following @gus', 'success');
    // The row still links to their profile.
    expect((await line('@gus followed you')).closest('a')?.getAttribute('href')).toBe('/users/gus');
  });

  it('keeps Follow back, and says why, when following fails', async () => {
    serve(
      [row({ type: 'follow', actorUsername: 'gus', actorId: 'u-gus', followingActor: false })],
      () => json({ success: false, error: 'Too many requests' }, 429)
    );
    render(<ActivityPage />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Follow back' }));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Too many requests', 'error'));
    expect(screen.getByRole('button', { name: 'Follow back' })).toBeEnabled();
  });

  it.each([
    ['you already follow them', { actorId: 'u-gus', followingActor: true }],
    ['their account is gone', { actorId: null, followingActor: null }],
  ])('offers no Follow back when %s', async (_label, state) => {
    serve([row({ type: 'follow', actorUsername: 'gus', ...state })]);
    render(<ActivityPage />);
    await line('@gus followed you');
    expect(screen.queryByRole('button', { name: 'Follow back' })).toBeNull();
  });

  it('a Follow back the previous account started changes nothing once another signs in', async () => {
    let answer: (v: unknown) => void = () => {};
    serve(
      [row({ type: 'follow', actorUsername: 'gus', actorId: 'u-gus', followingActor: false })],
      () => new Promise((resolve) => (answer = resolve))
    );
    const view = render(<ActivityPage />);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Follow back' }));

    // Another account, with its own follow from the same person, not yet followed.
    signedIn.id = 'u2';
    signedIn.username = 'other';
    view.rerender(<ActivityPage />);
    expect(await screen.findByRole('button', { name: 'Follow back' })).toBeInTheDocument();

    await act(async () => answer(json({ success: true })));
    expect(showToast).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Follow back' })).toBeInTheDocument();
  });

  it('offers no Follow back on a follow from several people', async () => {
    serve([
      row({
        type: 'follow',
        count: 3,
        actorUsername: 'fiona',
        actorUsernames: ['dan', 'eve', 'fiona'],
        actorId: 'u-fiona',
        followingActor: false,
      }),
    ]);
    render(<ActivityPage />);
    await line('@fiona and 2 others followed you');
    expect(screen.queryByRole('button', { name: 'Follow back' })).toBeNull();
  });

  // regression: a follow row for several people linked to the dashboard, and
  // then to the profile; it opens the viewer's own followers in place.
  it('regression: opens your followers in place from a follow by several people', async () => {
    const fetchMock = serve(
      [
        row({
          _id: 'n-follows',
          type: 'follow',
          count: 3,
          actorUsername: 'fiona',
          actorUsernames: ['dan', 'eve', 'fiona'],
        }),
      ],
      (url) => {
        if (url === '/api/users/u1/followers') {
          return json({
            success: true,
            data: [
              { _id: 'u-fiona', username: 'fiona', image: null },
              { _id: 'u-eve', username: 'eve', image: null },
            ],
          });
        }
        throw new Error(`unexpected fetch ${url}`);
      }
    );
    render(<ActivityPage />);
    const user = userEvent.setup();

    const several = await line('@fiona and 2 others followed you');
    expect(several.closest('a')).toBeNull();
    await user.click(several.closest('button')!);

    const dialog = await screen.findByRole('dialog', { name: 'Connections' });
    expect(await within(dialog).findByText('@eve')).toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: 'Followers' })).toBeChecked();
    expect(fetchMock).toHaveBeenCalledWith('/api/users/u1/followers', expect.anything());
    expect(push).not.toHaveBeenCalled();
  });
});

describe('Activity — a feed that couldn’t be loaded', () => {
  // regression: a failed read showed "You're all caught up", which claims
  // there's nothing new, with only a toast to say it wasn't so.
  it.each([
    ['a 5xx', async () => json({ success: false, error: 'Failed to fetch notifications' }, 500)],
    [
      'a network error',
      async () => {
        throw new TypeError('Failed to fetch');
      },
    ],
  ])(
    'regression: says so in its place after %s, with Try again, which reads it afresh',
    async (_label, fail) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) =>
          url === '/api/users/me/invites' ? json({ success: true, data: [] }) : fail()
        )
      );
      render(<ActivityPage />);

      await screen.findByRole('heading', { name: 'Couldn’t load notifications' });
      expect(screen.queryByText('You’re all caught up')).toBeNull();
      expect(showToast).not.toHaveBeenCalled();

      serve([row({ _id: 'n-follow', type: 'follow', actorUsername: 'alice' })]);
      await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));

      expect(await screen.findByText(/alice/)).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Couldn’t load notifications' })).toBeNull();
      expect(showToast).not.toHaveBeenCalled();
    }
  );
});
