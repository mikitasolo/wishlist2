// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';

const { push, replace } = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null, status: 'unauthenticated', update: vi.fn() }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace }) }));
// The header has its own session handling and tests.
vi.mock('@/components/AppHeader', () => ({ default: () => null }));
vi.mock('@/components/AuthButton', () => ({ default: () => null }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast: vi.fn() }) }));

import BookedPage from '@/app/booked/page';
import SettingsPage from '@/app/settings/page';
import ItemsPage from '@/app/items/page';
import NotificationsPage from '@/app/notifications/page';
import MyWishlistsPage from '@/app/wishlists/mine/page';
import SharedWishlistsPage from '@/app/wishlists/shared/page';
import { AUTH_ONLY_PATHS } from '@/lib/utils/callbackUrl';

const PAGES = [
  ['/booked', BookedPage],
  ['/settings', SettingsPage],
  ['/items', ItemsPage],
  ['/notifications', NotificationsPage],
  ['/wishlists/mine', MyWishlistsPage],
  ['/wishlists/shared', SharedWishlistsPage],
] as const;

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockRejectedValue(new Error('no request expected while signed out'));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// regression: these pages sent a signed-out visitor to `/`, so where they were
// going was lost: someone following a link to their invitations had to find
// their way back after signing in. (`/invites` is a server redirect to
// Activity now, which `test/unit/invitesRedirect.test.ts` covers.)
describe('a page that needs a session, opened signed out', () => {
  // Signing out on one of them goes home (AuthButton) only if it's on the list.
  it('covers exactly the pages on the auth-only list', () => {
    expect(PAGES.map(([path]) => path).sort()).toEqual([...AUTH_ONLY_PATHS].sort());
  });

  it.each(PAGES)(
    'regression: %s sends the visitor to sign in, continuing back to it',
    async (path, Page) => {
      render(<Page />);

      await waitFor(() =>
        expect(replace).toHaveBeenCalledWith(`/auth/signin?callbackUrl=${encodeURIComponent(path)}`)
      );
      expect(replace).toHaveBeenCalledTimes(1);
      // Replaced, not pushed: Back mustn't land on the page that redirects again.
      expect(push).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );
});
