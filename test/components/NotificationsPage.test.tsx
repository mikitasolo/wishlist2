// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach, onTestFinished } from 'vitest';
import { render, screen, cleanup, within, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { NotificationView } from '@/lib/utils/notifications';
import { setDiscreetMode } from '@/lib/hooks/useDiscreetMode';

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
    // regression: an account with no activity was told "You’re all caught up", which
    // congratulates nothing; the empty state now invites instead.
    expect(await screen.findByText('Nothing here yet')).toBeInTheDocument();
    expect(screen.queryByText(/all caught up/i)).toBeNull();
  });

  // WIS-312: the handle call belongs on Shared with you, not in what happened.
  it('has no username handle in its empty state', async () => {
    serve([]);
    render(<ActivityPage />);
    expect(await screen.findByText('Nothing here yet')).toBeInTheDocument();
    expect(screen.queryByText('@me')).toBeNull();
    expect(screen.queryByText(/invite you by/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy your profile link' })).toBeNull();
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

  // WIS-364: a group gift is a reservation, so No spoiler mode hides its rows'
  // words (which gift, which list) as they render; the data is untouched.
  it('hides what a group gift row says in No spoiler mode, and shows it again after', async () => {
    serve([
      row({
        type: 'group_gift_joined',
        actorUsername: 'bob',
        actorImage: 'https://blob.example/bob.jpg',
        itemName: 'Camera',
        wishlistName: 'Kitchen',
        wishlistSlug: 'kitchen',
        wishlistId: 'w1',
      }),
    ]);
    act(() => setDiscreetMode(true));
    try {
      render(<ActivityPage />);
      await line('A group gift update, hidden by No spoiler mode');
      expect(document.body.textContent).not.toContain('Camera');
      expect(document.body.textContent).not.toContain('Kitchen');
      // No link to the list, and no face.
      expect(document.querySelector('a[href*="kitchen"]')).toBeNull();
      expect(document.querySelector('img[src*="bob"]')).toBeNull();
      expect(document.body.textContent).not.toContain('bob');
      act(() => setDiscreetMode(false));
      await line('@bob joined the group gift for “Camera” on Kitchen');
      expect(document.querySelector('img[src*="bob"]')).not.toBeNull();
      expect(document.querySelector('a[href="/wishlists/kitchen"]')).not.toBeNull();
    } finally {
      act(() => setDiscreetMode(false));
    }
  });

  // WIS-384: a reminder about what you reserved is a reservation surface too.
  it('hides what a gift reminder says in No spoiler mode, and shows it again after', async () => {
    serve([
      row({
        _id: 'n-before',
        type: 'gift_reminder',
        wishlistName: 'Kitchen',
        wishlistSlug: 'kitchen',
        wishlistId: 'w1',
        occasionKind: 'birthday',
        occasionDate: '2026-10-17',
      }),
      row({
        _id: 'n-after',
        type: 'gift_nudge',
        wishlistName: 'Garden',
        wishlistSlug: 'garden',
        wishlistId: 'w2',
        occasionKind: 'wedding',
        occasionDate: '2026-10-02',
      }),
    ]);
    act(() => setDiscreetMode(true));
    try {
      render(<ActivityPage />);
      expect(await screen.findAllByText('A gift reminder, hidden by No spoiler mode')).toHaveLength(
        2
      );
      expect(document.body.textContent).not.toContain('Kitchen');
      expect(document.body.textContent).not.toContain('Garden');
      expect(document.body.textContent).not.toMatch(/reserved on/);
      expect(document.querySelector('a[href="/booked"]')).toBeNull();
      act(() => setDiscreetMode(false));
      await line('Did you give what you reserved on Garden? Mark it as given on Reserved');
      expect(document.body.textContent).toMatch(/don’t forget what you reserved on Kitchen/);
      expect(document.querySelectorAll('a[href="/booked"]')).toHaveLength(2);
    } finally {
      act(() => setDiscreetMode(false));
    }
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
      expect(screen.queryByText('Nothing here yet')).toBeNull();
      expect(showToast).not.toHaveBeenCalled();

      serve([row({ _id: 'n-follow', type: 'follow', actorUsername: 'alice' })]);
      await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));

      expect(await screen.findByText(/alice/)).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Couldn’t load notifications' })).toBeNull();
      expect(showToast).not.toHaveBeenCalled();
    }
  );
});

// WIS-403: the feed has its own heading, Today / Earlier groups by the viewer's
// local day, and unread rows that stand out (the nav badge stays the one count).
describe('Activity feed structure', () => {
  const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000 - 60_000).toISOString();

  it('labels the feed and groups rows into Today and Earlier', async () => {
    serve([
      row({
        _id: 'a',
        type: 'role_changed',
        wishlistName: 'Fresh',
        createdAt: new Date().toISOString(),
      }),
      row({ _id: 'b', type: 'role_changed', wishlistName: 'Old one', createdAt: daysAgo(3) }),
    ]);
    render(<ActivityPage />);
    await line('You’re now a member of Fresh');
    expect(screen.getByRole('heading', { name: 'Notifications', level: 2 })).toBeVisible();
    const groups = screen.getAllByRole('heading', { level: 3 });
    expect(groups.map((h) => h.textContent)).toEqual(['Today', 'Earlier']);
    const earlier = groups[1].parentElement as HTMLElement;
    expect(earlier.textContent).toContain('Old one');
    expect(earlier.textContent).not.toContain('Fresh');
  });

  it('leaves out a group with no rows', async () => {
    serve([
      row({ _id: 'b', type: 'role_changed', wishlistName: 'Old one', createdAt: daysAgo(3) }),
    ]);
    render(<ActivityPage />);
    await line('You’re now a member of Old one');
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Earlier',
    ]);
  });

  it('marks unread rows beyond the dot, and leaves read ones plain', async () => {
    serve([
      row({ _id: 'u', type: 'role_changed', wishlistName: 'New', read: false }),
      row({ _id: 'r', type: 'role_changed', wishlistName: 'Seen', read: true }),
    ]);
    render(<ActivityPage />);
    const unread = (await line('You’re now a member of New')).closest('li') as HTMLElement;
    const read = (await line('You’re now a member of Seen')).closest('li') as HTMLElement;
    expect(within(unread).getByLabelText('Unread')).toBeInTheDocument();
    expect(unread.firstElementChild?.className).toContain('border-l-primary-500');
    expect(read.firstElementChild?.className).not.toContain('border-l-primary-500');
    expect(within(read).queryByLabelText('Unread')).toBeNull();
  });

  // regression: the page marks everything read on open, so the focus re-read
  // returned `read: true` and the unread emphasis vanished mid-visit.
  it('keeps a row marked unread through a re-read that says it is read', async () => {
    let feed = [row({ _id: 'u', type: 'role_changed', wishlistName: 'New', read: false })];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === '/api/notifications?actors=1') {
          return json({ success: true, data: feed, unreadCount: 0 });
        }
        if (url === '/api/users/me/invites') return json({ success: true, data: [] });
        throw new Error(`unexpected fetch ${url} ${init?.method}`);
      })
    );
    render(<ActivityPage />);
    const li = (await line('You’re now a member of New')).closest('li') as HTMLElement;
    expect(within(li).getByLabelText('Unread')).toBeInTheDocument();
    feed = [{ ...feed[0], read: true }];
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(within(li).getByLabelText('Unread')).toBeInTheDocument();
  });

  // WIS-441: the feed's read marks what's unread as read, so it reads only for
  // someone looking: a tab shown in a window the viewer isn't in waits for
  // their focus.
  it('reads nothing, and marks nothing read, for a tab shown in an unfocused window', async () => {
    let feed = [row({ _id: 'n1', type: 'role_changed', wishlistName: 'New', read: true })];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/notifications?actors=1') {
        return json({ success: true, data: feed, unreadCount: feed.filter((n) => !n.read).length });
      }
      if (url === '/api/notifications' && init?.method === 'PATCH') return json({ success: true });
      if (url === '/api/users/me/invites') return json({ success: true, data: [] });
      throw new Error(`unexpected fetch ${url} ${init?.method}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const focused = vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    onTestFinished(() => focused.mockRestore());
    const calls = (url: string, method?: string) =>
      fetchMock.mock.calls.filter(([u, init]) => u === url && init?.method === method).length;
    render(<ActivityPage />);
    await line('You’re now a member of New');
    expect(calls('/api/notifications?actors=1')).toBe(1);

    // Something new arrives, and the tab is uncovered in a window nobody is in.
    feed = [row({ _id: 'n2', type: 'role_changed', wishlistName: 'Newer', read: false }), ...feed];
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('online'));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(calls('/api/notifications?actors=1')).toBe(1);
    expect(calls('/api/notifications', 'PATCH')).toBe(0);

    // They focus it: read, and only then marked read.
    focused.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await line('You’re now a member of Newer');
    expect(calls('/api/notifications?actors=1')).toBe(2);
    await waitFor(() => expect(calls('/api/notifications', 'PATCH')).toBe(1));
  });

  // WIS-376: returns go through the shared live-read layer.
  it('reads the feed once for a return that fires both events, and when back online', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/notifications?actors=1') {
        return json({ success: true, data: [], unreadCount: 0 });
      }
      if (url === '/api/users/me/invites') return json({ success: true, data: [] });
      throw new Error(`unexpected fetch ${url} ${init?.method}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    // Back online counts only in a focused window (jsdom has none).
    const focused = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    onTestFinished(() => focused.mockRestore());
    const feedReads = () =>
      fetchMock.mock.calls.filter(([url]) => url === '/api/notifications?actors=1').length;
    render(<ActivityPage />);
    await screen.findByText('Nothing here yet');
    expect(feedReads()).toBe(1);

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(feedReads()).toBe(2));

    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() => expect(feedReads()).toBe(3));
  });

  it('shows no Notifications heading with no rows', async () => {
    serve([]);
    render(<ActivityPage />);
    await screen.findByText('Nothing here yet');
    expect(screen.queryByRole('heading', { name: 'Notifications' })).toBeNull();
  });
});
