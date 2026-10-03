// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import type { NotificationView } from '@/lib/utils/notifications';

const { push, showToast } = vi.hoisted(() => ({ push: vi.fn(), showToast: vi.fn() }));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: 'u1', username: 'me' } }, status: 'authenticated' }),
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

/** The deepest element whose text is the whole line, list name included. */
const line = (text: string) =>
  screen.findByText(
    (_, el) =>
      el?.textContent === text && Array.from(el.children).every((c) => c.textContent !== text)
  );

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

    render(<NotificationsPage />);

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

  // regression: a follow row for several people linked to the dashboard.
  it("regression: links a follow from several people to the viewer's own followers", async () => {
    serve([
      row({
        _id: 'n-follows',
        type: 'follow',
        count: 3,
        actorUsername: 'fiona',
        actorUsernames: ['dan', 'eve', 'fiona'],
      }),
      row({ _id: 'n-follow', type: 'follow', actorUsername: 'gus', actorUsernames: ['gus'] }),
    ]);

    render(<NotificationsPage />);

    const several = await line('@fiona and 2 others followed you');
    expect(several.closest('a')?.getAttribute('href')).toBe('/users/me?followers=1');
    const one = await line('@gus followed you');
    expect(one.closest('a')?.getAttribute('href')).toBe('/users/gus');
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

    render(<NotificationsPage />);

    const joined = await line('You joined Housewarming');
    expect(joined.closest('a')?.getAttribute('href')).toBe('/wishlists/w1');
    const declined = await line('You declined the invite to Garden');
    expect(declined.closest('a')).toBeNull();
    expect(screen.queryByText(/invited you/)).toBeNull();
  });
});
