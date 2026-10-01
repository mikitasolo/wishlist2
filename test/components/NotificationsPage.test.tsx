// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { NotificationView } from '@/lib/utils/notifications';

const { push, showToast } = vi.hoisted(() => ({ push: vi.fn(), showToast: vi.fn() }));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: 'me' } }, status: 'authenticated' }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
// The header has its own fetches and tests; this file is about the feed rows.
vi.mock('@/components/AppHeader', () => ({ default: () => null }));
vi.mock('@/components/AuthButton', () => ({ default: () => null }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));

import NotificationsPage from '@/app/notifications/page';

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
    read: true,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function serve(data: NotificationView[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ success: true, data, unreadCount: 0 }) }))
  );
}

beforeEach(() => {
  push.mockReset();
  showToast.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('NotificationsPage', () => {
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

    render(<NotificationsPage />);

    const demoted = await screen.findByText('You’re now a member of “Family list”');
    expect(demoted.closest('a')?.getAttribute('href')).toBe('/wishlists/family-list');

    // The list may be hidden from them now, so the row isn't a link at all.
    const removed = screen.getByText('You were removed from “Book club”');
    expect(removed.closest('a')).toBeNull();
    expect(removed.closest('li')).not.toBeNull();
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });
});
