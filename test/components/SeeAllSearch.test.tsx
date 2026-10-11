// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

vi.mock('@/lib/hooks/useKnownSession', () => ({
  useKnownSession: () => ({
    data: { user: { id: 'me', username: 'me' } },
    status: 'authenticated',
  }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock('@/components/AppHeader', () => ({ default: () => null }));
vi.mock('@/components/AuthButton', () => ({ default: () => null }));
vi.mock('@/components/lazyModals', () => ({ CreateWishlistModal: () => null }));
vi.mock('@/lib/hooks/usePinToTop', () => ({
  usePinToTop: () => ({ pinning: null, toggle: vi.fn() }),
}));
// The rows have their own tests: here each list is just its name.
vi.mock('@/components/WishlistList', () => ({
  default: ({ wishlists }: { wishlists: { _id: string; name: string }[] }) => (
    <ul>
      {wishlists.map((w) => (
        <li key={w._id}>{w.name}</li>
      ))}
    </ul>
  ),
  ArchivedLists: ({ wishlists }: { wishlists: { _id: string; name: string }[] }) => (
    <ul aria-label="Archived">
      {wishlists.map((w) => (
        <li key={w._id}>{w.name}</li>
      ))}
    </ul>
  ),
}));

import MyWishlistsPage from '@/app/wishlists/mine/page';
import SharedWishlistsPage from '@/app/wishlists/shared/page';

const owned = [
  { _id: 'o1', name: 'Birthday 2026', archived: false },
  { _id: 'o2', name: 'Christmas', archived: false },
  { _id: 'o3', name: 'Birthday 2019', archived: true },
];
const member = [
  { _id: 'm1', name: 'Anna’s list', ownerUsername: 'ann', ownerUsernames: ['ann', 'bob'] },
  { _id: 'm2', name: 'Camping', ownerUsername: 'cy', ownerUsernames: ['cy'] },
];

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ json: async () => ({ success: true, data: { owned, member } }) }))
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('See all search (WIS-427)', () => {
  it('filters Your wishlists by name, the Archived fold included', async () => {
    window.history.replaceState(null, '', '/wishlists/mine');
    render(<MyWishlistsPage />);
    await screen.findByText('Christmas');
    fireEvent.change(screen.getByRole('textbox', { name: 'Search your wishlists' }), {
      target: { value: 'birthday' },
    });
    await waitFor(() => expect(screen.queryByText('Christmas')).toBeNull());
    expect(screen.getByText('Birthday 2026')).toBeTruthy();
    expect(screen.getByText('Birthday 2019')).toBeTruthy();
    expect(window.location.search).toBe('?q=birthday');
  });

  it('says so when no list matches', async () => {
    window.history.replaceState(null, '', '/wishlists/mine?q=zzz');
    render(<MyWishlistsPage />);
    expect(await screen.findByText('No wishlists found')).toBeTruthy();
    expect(screen.queryByText('Christmas')).toBeNull();
  });

  it('matches a co-owner’s username on Shared with you', async () => {
    window.history.replaceState(null, '', '/wishlists/shared?q=bob');
    render(<SharedWishlistsPage />);
    expect(await screen.findByText('Anna’s list')).toBeTruthy();
    expect(screen.queryByText('Camping')).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search shared wishlists' }), {
      target: { value: 'nobody' },
    });
    expect(await screen.findByText('No wishlists found')).toBeTruthy();
  });
});
