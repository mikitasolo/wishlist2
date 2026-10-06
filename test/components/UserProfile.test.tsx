// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, within, fireEvent, act } from '@testing-library/react';
import type { ReactNode } from 'react';

type Session = {
  data: { user: { id: string; username: string } } | null;
  status: 'loading' | 'authenticated' | 'unauthenticated';
};

const { push, router, showToast, session, signIn } = vi.hoisted(() => {
  const push = vi.fn();
  return {
    push,
    // The same router on every render, as Next's is: the page's load depends on it.
    router: { push },
    showToast: vi.fn(),
    signIn: vi.fn(),
    // Mutable, so a test can let the session resolve while the page is open.
    session: { current: { data: null, status: 'loading' } as Session },
  };
});

vi.mock('next-auth/react', () => ({ useSession: () => session.current, signIn }));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  useParams: () => ({ username: 'friend' }),
  usePathname: () => '/users/friend',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// The header, the share button and the follow list have their own fetches and
// tests; this file is about the profile's own load and what it shows.
vi.mock('@/components/AppHeader', () => ({ default: () => null }));
vi.mock('@/components/AuthButton', () => ({ default: () => null }));
vi.mock('@/components/ShareButton', () => ({ default: () => <button>Share</button> }));
vi.mock('@/components/FollowListModal', () => ({ default: () => null }));
vi.mock('@/components/CreateWishlistModal', () => ({
  default: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div role="dialog" aria-label="Create new wishlist" /> : null,
}));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));

import UserProfile from '@/app/users/[username]/page';

const signedIn = (username: string): Session => ({
  data: { user: { id: `${username}-id`, username } },
  status: 'authenticated',
});

function profile(fields: Record<string, unknown> = {}) {
  return {
    _id: 'friend-id',
    username: 'friend',
    image: null,
    bio: null,
    isSelf: false,
    isFollowing: false,
    followsYou: false,
    isFriend: false,
    followerCount: 0,
    followingCount: 0,
    ...fields,
  };
}

function json(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

/** Answers the profile's two reads: the user, then their lists. */
function stubFetch(
  user = profile(),
  wishlists: unknown[] = [],
  extra: Record<string, unknown> = {}
) {
  const fetchMock = vi.fn(async (url: string) => {
    if (url === '/api/users/by-username/friend') return json({ success: true, data: user });
    if (url === '/api/users/friend-id/wishlists')
      return json({ success: true, data: wishlists, ...extra });
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const reads = (fetchMock: ReturnType<typeof vi.fn>, url: string) =>
  fetchMock.mock.calls.filter(([called]) => called === url).length;

beforeEach(() => {
  cleanup();
  push.mockReset();
  showToast.mockReset();
  signIn.mockReset();
  session.current = { data: null, status: 'loading' };
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('UserProfile — loading', () => {
  // regression: the load effect depended on `session?.user?.username`, which goes
  // from undefined to the viewer's username once the session is read, so every
  // signed-in visit loaded the profile twice: the skeleton showed twice, and a
  // failure stacked two "Failed to load profile" toasts.
  it('regression: loads the profile once for a signed-in visitor', async () => {
    const fetchMock = stubFetch();
    const { rerender } = render(<UserProfile />);
    // Nothing is read until the session is.
    expect(fetchMock).not.toHaveBeenCalled();

    session.current = signedIn('me');
    rerender(<UserProfile />);
    expect(await screen.findByRole('heading', { name: '@friend' })).toBeInTheDocument();

    expect(reads(fetchMock, '/api/users/by-username/friend')).toBe(1);
    expect(reads(fetchMock, '/api/users/friend-id/wishlists')).toBe(1);
  });

  // A failed load is said in place (with Try again), not toasted: it's still
  // read, and said, once.
  it('regression: says a failed load once', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);
    const { rerender } = render(<UserProfile />);

    session.current = signedIn('me');
    rerender(<UserProfile />);

    await screen.findByRole('heading', { level: 1, name: 'Couldn’t load this profile' });
    expect(screen.getAllByRole('button', { name: 'Try again' })).toHaveLength(1);
    expect(showToast).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('loads it once for a signed-out visitor too', async () => {
    const fetchMock = stubFetch();
    const { rerender } = render(<UserProfile />);

    session.current = { data: null, status: 'unauthenticated' };
    rerender(<UserProfile />);
    expect(await screen.findByRole('heading', { name: '@friend' })).toBeInTheDocument();

    expect(reads(fetchMock, '/api/users/by-username/friend')).toBe(1);
  });

  it('loads it again when the visitor signs out, since what it shows depends on who looks', async () => {
    session.current = signedIn('me');
    const fetchMock = stubFetch();
    const { rerender } = render(<UserProfile />);
    await screen.findByRole('heading', { name: '@friend' });

    session.current = { data: null, status: 'unauthenticated' };
    rerender(<UserProfile />);

    await waitFor(() => expect(reads(fetchMock, '/api/users/by-username/friend')).toBe(2));
  });

  it('loads it again when another account takes over the session (from another tab)', async () => {
    session.current = signedIn('me');
    const fetchMock = stubFetch();
    const { rerender } = render(<UserProfile />);
    await screen.findByRole('heading', { name: '@friend' });

    session.current = signedIn('someone-else');
    rerender(<UserProfile />);

    await waitFor(() => expect(reads(fetchMock, '/api/users/by-username/friend')).toBe(2));
  });

  it('does not load it again when the same session is read again (the tab shown again)', async () => {
    session.current = signedIn('me');
    const fetchMock = stubFetch();
    const { rerender } = render(<UserProfile />);
    await screen.findByRole('heading', { name: '@friend' });

    session.current = signedIn('me'); // a new object, as a refetch gives
    rerender(<UserProfile />);
    await screen.findByRole('heading', { name: '@friend' });

    expect(reads(fetchMock, '/api/users/by-username/friend')).toBe(1);
  });

  it("drops a load the viewer changed during, so it can't show what the previous viewer could", async () => {
    session.current = signedIn('me');
    // The signed-in read of the user is held until the test answers it; the
    // signed-out one after it is answered at once.
    let answerSignedIn!: () => void;
    const held = new Promise<void>((resolve) => (answerSignedIn = resolve));
    let userReads = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/users/by-username/friend') {
          userReads += 1;
          if (userReads === 1) {
            await held;
            return json({ success: true, data: profile({ isFriend: true, followerCount: 5 }) });
          }
          return json({ success: true, data: profile({ followerCount: 1 }) });
        }
        if (url === '/api/users/friend-id/wishlists') return json({ success: true, data: [] });
        throw new Error(`unexpected fetch ${url}`);
      })
    );
    const { rerender } = render(<UserProfile />);
    await waitFor(() => expect(userReads).toBe(1));

    session.current = { data: null, status: 'unauthenticated' };
    rerender(<UserProfile />);
    expect(await screen.findByRole('button', { name: '1 follower' })).toBeInTheDocument();

    // The signed-in read answers last; give it every chance to land.
    await act(async () => {
      answerSignedIn();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(screen.queryByText('Friends')).toBeNull();
    expect(screen.getByRole('button', { name: '1 follower' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '5 followers' })).toBeNull();
  });
});

describe('UserProfile — with no wishlists to show', () => {
  /** The empty state, under the profile's header. */
  async function emptyState() {
    const icon = await screen.findByRole('heading', { level: 3 });
    return icon.parentElement as HTMLElement;
  }

  // regression: your own empty profile said "This person has no wishlists you
  // can view right now", in the third person, with nothing to do about it.
  it('regression: on your own profile, says you have none and offers to make one', async () => {
    session.current = signedIn('friend');
    stubFetch(profile({ isSelf: true }));
    render(<UserProfile />);

    const empty = await emptyState();
    expect(within(empty).getByRole('heading', { level: 3 })).toHaveTextContent(
      'You haven’t made a wishlist yet'
    );
    expect(empty).not.toHaveTextContent(/this person|hasn.t shared/i);

    expect(screen.queryByRole('dialog', { name: 'Create new wishlist' })).toBeNull();
    fireEvent.click(within(empty).getByRole('button', { name: 'New list' }));
    expect(screen.getByRole('dialog', { name: 'Create new wishlist' })).toBeInTheDocument();
  });

  // regression: the profile leaves archived lists out, so an owner whose lists
  // were all archived was told they hadn't made a wishlist yet.
  it('regression: on your own profile, does not say you never made one when all your lists are archived', async () => {
    session.current = signedIn('friend');
    stubFetch(profile({ isSelf: true }), [], { archivedCount: 2 });
    render(<UserProfile />);

    const empty = await emptyState();
    expect(within(empty).getByRole('heading', { level: 3 })).toHaveTextContent(
      'No wishlists on your profile'
    );
    expect(empty).toHaveTextContent('Archived lists aren’t shown on your profile.');
    expect(empty).not.toHaveTextContent(/haven.t made/i);
    expect(within(empty).getByRole('button', { name: 'New list' })).toBeInTheDocument();
  });

  it("on someone else's, says they haven't shared any with you, and offers nothing to do", async () => {
    session.current = signedIn('me');
    stubFetch();
    render(<UserProfile />);

    const empty = await emptyState();
    expect(empty).toHaveTextContent('No wishlists to show');
    expect(empty).toHaveTextContent('@friend hasn’t shared any wishlists with you yet.');
    expect(within(empty).queryByRole('button')).toBeNull();
  });

  it('says the same to a signed-out visitor', async () => {
    session.current = { data: null, status: 'unauthenticated' };
    stubFetch();
    render(<UserProfile />);

    const empty = await emptyState();
    expect(empty).toHaveTextContent('@friend hasn’t shared any wishlists with you yet.');
    expect(within(empty).queryByRole('button')).toBeNull();
  });
});

describe('UserProfile — birthday (WIS-323)', () => {
  it('shows the month and day when the answer carries a birthday, never a year', async () => {
    session.current = signedIn('me');
    stubFetch(profile({ birthday: '2000-03-14' }));
    render(<UserProfile />);

    const line = await screen.findByText(/March 14|14 March/);
    expect(line.closest('p')).not.toHaveTextContent('2000');
    expect(line.closest('p')).not.toHaveTextContent('can see it');
  });

  it('shows nothing when the answer has no birthday', async () => {
    session.current = signedIn('me');
    stubFetch(profile());
    render(<UserProfile />);

    await screen.findByRole('button', { name: '0 followers' });
    expect(screen.queryByText(/Birthday:/)).toBeNull();
  });

  it('on your own profile, says who else can see it', async () => {
    session.current = signedIn('friend');
    stubFetch(profile({ isSelf: true, birthday: '2000-02-29', birthdayAudience: 'nobody' }));
    render(<UserProfile />);

    const line = await screen.findByText(/February 29|29 February/);
    expect(line.closest('p')).toHaveTextContent('Only you can see it');
  });
});

describe('UserProfile — follower counts', () => {
  // regression: the profile read "1 followers": it wrote a plural noun after
  // the count, whatever the count.
  it('regression: agrees each count with its noun', async () => {
    session.current = signedIn('me');
    stubFetch(profile({ followerCount: 1, followingCount: 1 }));
    render(<UserProfile />);

    expect(await screen.findByRole('button', { name: '1 follower' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1 following' })).toBeInTheDocument();
  });

  it('uses the plural for any other count', async () => {
    session.current = signedIn('me');
    stubFetch(profile({ followerCount: 0, followingCount: 3 }));
    render(<UserProfile />);

    expect(await screen.findByRole('button', { name: '0 followers' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '3 following' })).toBeInTheDocument();
  });
});

describe('UserProfile — following', () => {
  function stubWithFollow(user: ReturnType<typeof profile>, wishlistsStatus = 200) {
    const fetchMock = vi.fn(async (url: string, init?: { method?: string }) => {
      if (url === '/api/users/by-username/friend') return json({ success: true, data: user });
      if (url === '/api/users/friend-id/wishlists') {
        return wishlistsStatus === 403
          ? { ok: false, status: 403, json: async () => ({ success: false }) }
          : json({ success: true, data: [] });
      }
      if (url === '/api/users/friend-id/follow') return json({ success: true, init });
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }
  const follows = (fetchMock: ReturnType<typeof vi.fn>) =>
    fetchMock.mock.calls.filter(([url]) => url === '/api/users/friend-id/follow');

  it('puts Follow before Share and names what the button does', async () => {
    session.current = signedIn('me');
    stubWithFollow(profile());
    render(<UserProfile />);
    const follow = await screen.findByRole('button', { name: 'Follow @friend' });
    const share = screen.getByRole('button', { name: 'Share' });
    expect(follow.compareDocumentPosition(share) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('names Following as Unfollow', async () => {
    session.current = signedIn('me');
    stubWithFollow(profile({ isFollowing: true }));
    render(<UserProfile />);
    expect(await screen.findByRole('button', { name: 'Unfollow @friend' })).toBeTruthy();
  });

  it('asks before unfollowing a friend, and Cancel keeps following', async () => {
    session.current = signedIn('me');
    const fetchMock = stubWithFollow(
      profile({ isFollowing: true, followsYou: true, isFriend: true })
    );
    render(<UserProfile />);
    fireEvent.click(await screen.findByRole('button', { name: 'Unfollow @friend' }));
    expect(await screen.findByText('Unfollow @friend?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(follows(fetchMock)).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Unfollow @friend' })).toBeTruthy();
  });

  it('unfollows a friend once confirmed', async () => {
    session.current = signedIn('me');
    const fetchMock = stubWithFollow(
      profile({ isFollowing: true, followsYou: true, isFriend: true })
    );
    render(<UserProfile />);
    fireEvent.click(await screen.findByRole('button', { name: 'Unfollow @friend' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Unfollow' }));
    await waitFor(() => expect(follows(fetchMock)).toHaveLength(1));
    expect(follows(fetchMock)[0][1]).toMatchObject({ method: 'DELETE' });
  });

  it('stops showing a birthday once you unfollow a friend (WIS-323)', async () => {
    session.current = signedIn('me');
    stubWithFollow(
      profile({ isFollowing: true, followsYou: true, isFriend: true, birthday: '2000-03-14' })
    );
    render(<UserProfile />);
    await screen.findByText(/March 14|14 March/);
    fireEvent.click(screen.getByRole('button', { name: 'Unfollow @friend' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Unfollow' }));

    await waitFor(() => expect(screen.queryByText(/March 14|14 March/)).toBeNull());
  });

  it('unfollows someone who is not a friend with no confirmation', async () => {
    session.current = signedIn('me');
    const fetchMock = stubWithFollow(profile({ isFollowing: true }));
    render(<UserProfile />);
    fireEvent.click(await screen.findByRole('button', { name: 'Unfollow @friend' }));
    await waitFor(() => expect(follows(fetchMock)).toHaveLength(1));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('says what a friends-only profile needs, before and after following', async () => {
    session.current = signedIn('me');
    stubWithFollow(profile(), 403);
    render(<UserProfile />);
    expect(await screen.findByText(/Follow each other to become friends/)).toBeTruthy();
    expect(screen.queryByText(/private/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Follow @friend' }));
    expect(
      await screen.findByText(
        'Only @friend’s friends can see their wishlists. You’ll see them once they follow you back.'
      )
    ).toBeTruthy();
  });

  it('sends a signed-out visitor to sign in, back to the profile', async () => {
    session.current = { data: null, status: 'unauthenticated' };
    const fetchMock = stubWithFollow(profile());
    render(<UserProfile />);
    fireEvent.click(await screen.findByRole('button', { name: 'Follow @friend' }));
    expect(signIn).toHaveBeenCalledWith(undefined, { redirectTo: window.location.href });
    expect(showToast).not.toHaveBeenCalled();
    expect(follows(fetchMock)).toHaveLength(0);
  });
});

/** A list as `GET /api/users/[id]/wishlists` sends it. */
function list(id: string, fields: Record<string, unknown> = {}) {
  return {
    _id: id,
    name: `List ${id}`,
    slug: id,
    visibility: 'everyone',
    owners: ['friend-id'],
    ownerUsername: 'friend',
    ownerUsernames: ['friend'],
    itemCount: 0,
    occasion: null,
    ...fields,
  };
}

/** The list cards' names, in the order they're shown. */
const cardNames = () =>
  screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent);

describe('UserProfile — the lists', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('puts the nearest occasion first, in the viewer’s local date', async () => {
    // Only the clock is faked, so the page's own waits still run.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 4, 12)); // 4 Oct 2026, local
    session.current = signedIn('me');
    // Newest first, as the API sends them.
    stubFetch(profile(), [
      list('none'),
      list('christmas', { occasion: { kind: 'holiday', date: '2026-12-25', recurrence: null } }),
      list('passed', { occasion: { kind: 'other', date: '2026-01-01', recurrence: null } }),
      list('birthday', {
        occasion: { kind: 'birthday', date: '2000-10-18', recurrence: 'yearly' },
      }),
    ]);
    render(<UserProfile />);
    await screen.findByRole('heading', { name: 'List birthday' });

    // The birthday in 14 days, then Christmas, then the rest in the API's order.
    expect(cardNames()).toEqual(['List birthday', 'List christmas', 'List none', 'List passed']);
  });

  it('names the other owners only on a co-owned list, never the profile’s own person', async () => {
    session.current = signedIn('me');
    stubFetch(profile(), [
      list('solo'),
      list('shared', {
        owners: ['friend-id', 'chloe-id'],
        ownerUsernames: ['friend', 'chloe_r'],
      }),
      // The profile's person needn't be the primary owner.
      list('theirs', {
        owners: ['dan-id', 'friend-id'],
        ownerUsername: 'dan_w',
        ownerUsernames: ['dan_w', 'friend'],
      }),
    ]);
    render(<UserProfile />);

    const card = async (name: string) =>
      (await screen.findByRole('heading', { name })).closest('a') as HTMLElement;
    expect(await card('List shared')).toHaveTextContent('with @chloe_r');
    expect(await card('List shared')).not.toHaveTextContent('@friend');
    expect(await card('List theirs')).toHaveTextContent('with @dan_w');
    expect(await card('List solo')).not.toHaveTextContent(/with |@friend/);
  });

  it('tells you on your own profile how many of your lists visitors see', async () => {
    session.current = signedIn('friend');
    stubFetch(
      profile({ isSelf: true }),
      [list('a'), list('b', { visibility: 'friends' }), list('c', { visibility: 'private' })],
      { visitorCount: 1 }
    );
    render(<UserProfile />);

    expect(await screen.findByText('Visitors see 1 of your 3 lists')).toBeInTheDocument();
  });

  it('says nothing about visitors on anyone else’s profile, even if a count were sent', async () => {
    session.current = signedIn('me');
    stubFetch(profile(), [list('a')], { visitorCount: 1 });
    render(<UserProfile />);

    await screen.findByRole('heading', { name: 'List a' });
    expect(screen.queryByText(/visitors/i)).toBeNull();
  });
});
