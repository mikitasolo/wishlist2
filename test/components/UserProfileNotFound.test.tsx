// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { router, showToast, auth } = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
  showToast: vi.fn(),
  auth: { signedIn: true },
}));

vi.mock('next-auth/react', () => ({
  useSession: () =>
    auth.signedIn
      ? { data: { user: { id: 'me', username: 'me' } }, status: 'authenticated' }
      : { data: null, status: 'unauthenticated' },
  signIn: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  useParams: () => ({ username: 'nobody_here' }),
  usePathname: () => '/users/nobody_here',
  useSearchParams: () => new URLSearchParams(),
}));

// The header and the search have their own fetches and tests; here the search
// only has to be offered.
vi.mock('@/components/AppHeader', () => ({ default: () => null }));
vi.mock('@/components/AuthButton', () => ({ default: () => null }));
vi.mock('@/components/ShareButton', () => ({ default: () => null }));
vi.mock('@/components/GlobalSearch', () => ({
  default: ({ variant }: { variant?: string }) => (
    <input aria-label="Search people & wishlists" data-variant={variant} />
  ),
}));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));

import UserProfile from '@/app/users/[username]/page';

type Answer = { status: number; body: unknown } | Error;
let profileAnswer: () => Answer;
/** How the profile's wishlists read is answered. */
let listsAnswer: () => Answer;

const PROFILE = {
  _id: 'u1',
  username: 'nobody_here',
  image: null,
  bio: null,
  isSelf: false,
  isFollowing: false,
  followsYou: false,
  isFriend: false,
  followerCount: 0,
  followingCount: 0,
};

const fetchMock = vi.fn();
const profileReads = () =>
  fetchMock.mock.calls.filter(([url]) => url === '/api/users/by-username/nobody_here').length;

beforeEach(() => {
  fetchMock.mockReset();
  auth.signedIn = true;
  listsAnswer = () => ({ status: 200, body: { success: true, data: [] } });
  fetchMock.mockImplementation(async (url: string) => {
    const answer: Answer =
      url === '/api/users/by-username/nobody_here'
        ? profileAnswer()
        : url === '/api/users/u1/wishlists'
          ? listsAnswer()
          : { status: 404, body: { success: false, error: 'Not mocked' } };
    if (answer instanceof Error) throw answer;
    return { ok: answer.status < 400, status: answer.status, json: async () => answer.body };
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

describe('the profile of a username no one has', () => {
  // regression: an unknown username toasted "User not found" and sent the
  // visitor home (router.push('/')), losing the URL they'd followed.
  it.each([
    ['signed in', true, 'Back to your wishlists'],
    ['signed out', false, 'Go home'],
  ])(
    'regression: says so in place, %s, with the search to find them',
    async (_label, signedIn, home) => {
      auth.signedIn = signedIn;
      profileAnswer = () => ({ status: 404, body: { success: false, error: 'User not found' } });
      render(<UserProfile />);

      await screen.findByRole('heading', { level: 1, name: 'No one goes by @nobody_here' });
      await settle();
      expect(screen.getByRole('textbox', { name: 'Search people & wishlists' })).toHaveAttribute(
        'data-variant',
        'inline'
      );
      expect(screen.getByRole('link', { name: home })).toHaveAttribute('href', '/');
      expect(router.push).not.toHaveBeenCalled();
      expect(router.replace).not.toHaveBeenCalled();
      expect(showToast).not.toHaveBeenCalled();
      // No follow buttons or counts for a profile that isn't there.
      expect(screen.queryByRole('button', { name: /Follow/ })).toBeNull();
    }
  );
});

describe('a profile that couldn’t be loaded', () => {
  it.each<[string, () => Answer]>([
    ['a 5xx', () => ({ status: 500, body: { success: false, error: 'Failed to fetch user' } })],
    ['a rate limit', () => ({ status: 429, body: { success: false, error: 'Too many requests' } })],
    ['a network error', () => new TypeError('Failed to fetch')],
  ])('offers Try again after %s, which reads it afresh', async (_label, fail) => {
    profileAnswer = fail;
    render(<UserProfile />);

    await screen.findByRole('heading', { level: 1, name: 'Couldn’t load this profile' });
    await settle();
    expect(screen.queryByRole('heading', { name: /No one goes by/ })).toBeNull();
    expect(router.push).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();

    profileAnswer = () => ({ status: 200, body: { success: true, data: PROFILE } });
    const reads = profileReads();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));

    await screen.findByRole('heading', { level: 1, name: '@nobody_here' });
    expect(profileReads()).toBe(reads + 1);
    expect(screen.getByRole('button', { name: 'Follow' })).toBeInTheDocument();
  });
});

describe('a profile whose wishlists couldn’t be loaded', () => {
  const LIST = {
    _id: 'w1',
    slug: 'birthday',
    name: 'Birthday',
    visibility: 'everyone',
    owners: ['u1'],
    ownerUsername: 'nobody_here',
    itemCount: 2,
    occasion: null,
  };

  // regression: a failed read of their wishlists showed "No wishlists to
  // show", which claims they have none you can see, and toasted "Failed to
  // load profile" about a profile that was on screen.
  it.each<[string, () => Answer]>([
    ['a 5xx', () => ({ status: 500, body: { success: false, error: 'Failed to fetch' } })],
    ['a network error', () => new TypeError('Failed to fetch')],
  ])(
    'regression: says so in their place after %s, with Try again, which reads them afresh',
    async (_label, fail) => {
      profileAnswer = () => ({ status: 200, body: { success: true, data: PROFILE } });
      listsAnswer = fail;
      render(<UserProfile />);

      await screen.findByRole('heading', { name: 'Couldn’t load @nobody_here’s wishlists' });
      // The profile itself is shown.
      expect(screen.getByRole('heading', { level: 1, name: '@nobody_here' })).toBeInTheDocument();
      expect(screen.queryByText('No wishlists to show')).toBeNull();
      expect(showToast).not.toHaveBeenCalled();

      listsAnswer = () => ({ status: 200, body: { success: true, data: [LIST] } });
      await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));

      expect(await screen.findByText('Birthday')).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: /Couldn’t load/ })).toBeNull();
      expect(showToast).not.toHaveBeenCalled();
    }
  );

  it('speaks of your own wishlists on your own profile', async () => {
    profileAnswer = () => ({
      status: 200,
      body: { success: true, data: { ...PROFILE, isSelf: true } },
    });
    listsAnswer = () => ({ status: 500, body: { success: false, error: 'Failed to fetch' } });
    render(<UserProfile />);

    expect(
      await screen.findByRole('heading', { name: 'Couldn’t load your wishlists' })
    ).toBeInTheDocument();
  });
});
