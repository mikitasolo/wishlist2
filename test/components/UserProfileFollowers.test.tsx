// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

const { nav } = vi.hoisted(() => ({
  nav: { search: '', pathname: '/users/anna', push: vi.fn() },
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: 'u1', username: 'anna' } }, status: 'authenticated' }),
}));
vi.mock('next/navigation', () => ({
  useParams: () => ({ username: 'anna' }),
  useRouter: () => ({ push: nav.push }),
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
}));
// The header has its own fetches and tests; this file is about the followers list.
vi.mock('@/components/AppHeader', () => ({ default: () => null }));
vi.mock('@/components/AuthButton', () => ({ default: () => null }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast: vi.fn() }) }));

import UserProfile from '@/app/users/[username]/page';

const profile = {
  _id: 'u1',
  username: 'anna',
  image: null,
  bio: null,
  isSelf: true,
  isFollowing: false,
  followsYou: false,
  isFriend: false,
  followerCount: 3,
  followingCount: 1,
};

const fetchMock = vi.fn(async (url: string) => {
  const data = url.startsWith('/api/users/by-username/')
    ? profile
    : url.endsWith('/followers')
      ? [{ _id: 'u2', username: 'fiona', image: null }]
      : [];
  return { ok: true, status: 200, json: async () => ({ success: true, data }) };
});

// useBodyScrollLock restores the scroll position on close; jsdom lacks scrollTo.
beforeAll(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterAll(() => vi.restoreAllMocks());

beforeEach(() => {
  nav.search = '';
  nav.push.mockReset();
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function renderProfile(search = '') {
  nav.search = search;
  render(<UserProfile />);
  await screen.findByRole('heading', { name: '@anna' });
}

describe('UserProfile — the followers list from the URL', () => {
  // A follow notification for several people links here (`followersHref`).
  it('opens the followers list when the URL asks for it', async () => {
    await renderProfile('followers=1');

    const dialog = await screen.findByRole('dialog', { name: 'Connections' });
    expect(dialog).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: '@fiona' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/users/u1/followers', expect.anything());
  });

  it('keeps it closed otherwise', async () => {
    await renderProfile();

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalledWith('/api/users/u1/followers', expect.anything());
  });

  // So reloading or sharing the profile (Share copies the page's URL) doesn't
  // open it again.
  it('takes the parameter off the URL when it closes, keeping any other', async () => {
    const replaceState = vi.spyOn(window.history, 'replaceState');
    try {
      await renderProfile('followers=1&ref=bell');
      await screen.findByRole('dialog', { name: 'Connections' });

      fireEvent.click(screen.getByRole('button', { name: 'Close' }));

      expect(screen.queryByRole('dialog')).toBeNull();
      expect(replaceState).toHaveBeenCalledTimes(1);
      expect(replaceState).toHaveBeenCalledWith(null, '', '/users/anna?ref=bell');
    } finally {
      replaceState.mockRestore();
    }
  });

  it('leaves the URL alone when the list was opened from the page', async () => {
    const replaceState = vi.spyOn(window.history, 'replaceState');
    try {
      await renderProfile();
      fireEvent.click(screen.getByRole('button', { name: /followers/ }));
      await screen.findByRole('dialog', { name: 'Connections' });

      fireEvent.click(screen.getByRole('button', { name: 'Close' }));

      expect(screen.queryByRole('dialog')).toBeNull();
      expect(replaceState).not.toHaveBeenCalled();
    } finally {
      replaceState.mockRestore();
    }
  });
});
