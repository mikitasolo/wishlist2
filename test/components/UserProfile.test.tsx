// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, within, fireEvent, act } from '@testing-library/react';
import type { ReactNode } from 'react';

type Session = {
  data: { user: { id: string; username: string } } | null;
  status: 'loading' | 'authenticated' | 'unauthenticated';
};

const { push, router, showToast, session } = vi.hoisted(() => {
  const push = vi.fn();
  return {
    push,
    // The same router on every render, as Next's is: the page's load depends on it.
    router: { push },
    showToast: vi.fn(),
    // Mutable, so a test can let the session resolve while the page is open.
    session: { current: { data: null, status: 'loading' } as Session },
  };
});

vi.mock('next-auth/react', () => ({ useSession: () => session.current }));
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
vi.mock('@/components/ShareButton', () => ({ default: () => null }));
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
function stubFetch(user = profile(), wishlists: unknown[] = []) {
  const fetchMock = vi.fn(async (url: string) => {
    if (url === '/api/users/by-username/friend') return json({ success: true, data: user });
    if (url === '/api/users/friend-id/wishlists') return json({ success: true, data: wishlists });
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

  it('regression: says a failed load once, with one toast', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);
    const { rerender } = render(<UserProfile />);

    session.current = signedIn('me');
    rerender(<UserProfile />);

    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Failed to load profile', 'error'));
    expect(showToast).toHaveBeenCalledTimes(1);
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
