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
  fetchMock.mockImplementation(async (url: string) => {
    const answer: Answer =
      url === '/api/users/by-username/nobody_here'
        ? profileAnswer()
        : url === '/api/users/u1/wishlists'
          ? { status: 200, body: { success: true, data: [] } }
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
