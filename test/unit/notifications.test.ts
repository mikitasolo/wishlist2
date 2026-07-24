import { describe, it, expect } from 'vitest';
import {
  notificationText,
  notificationLink,
  notificationIcon,
  type NotificationView,
} from '@/lib/utils/notifications';

function make(overrides: Partial<NotificationView>): NotificationView {
  return {
    _id: 'n1',
    type: 'follow',
    actorUsername: null,
    wishlistName: null,
    wishlistSlug: null,
    wishlistId: null,
    itemName: null,
    read: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('notificationText', () => {
  it('names the actor for follows and invites', () => {
    expect(notificationText(make({ type: 'follow', actorUsername: 'alice' }))).toBe(
      '@alice started following you'
    );
    expect(
      notificationText(
        make({ type: 'wishlist_invite', actorUsername: 'bob', wishlistName: 'Birthday' })
      )
    ).toBe('@bob invited you to Birthday');
    expect(
      notificationText(
        make({ type: 'invite_accepted', actorUsername: 'cara', wishlistName: 'Wedding' })
      )
    ).toBe('@cara accepted your invitation to Wedding');
  });

  // regression: owners must NEVER learn who proposed an item — the proposal
  // notification is anonymous regardless of any actor value.
  it('keeps proposals anonymous', () => {
    const text = notificationText(
      make({ type: 'proposal', actorUsername: 'should-not-appear', wishlistName: 'Kitchen' })
    );
    expect(text).toBe('Someone proposed an item for Kitchen');
    expect(text).not.toContain('should-not-appear');
  });

  it('names the item for an approved proposal, with a fallback', () => {
    expect(
      notificationText(
        make({ type: 'proposal_approved', itemName: 'Kettle', wishlistName: 'Kitchen' })
      )
    ).toBe('Your proposed item “Kettle” was accepted in Kitchen');
    expect(notificationText(make({ type: 'proposal_approved', wishlistName: 'Kitchen' }))).toBe(
      'Your proposed item was accepted in Kitchen'
    );
  });

  it('falls back to "Someone" when an actor is missing', () => {
    expect(notificationText(make({ type: 'follow', actorUsername: null }))).toBe(
      'Someone started following you'
    );
  });
});

describe('notificationLink', () => {
  it('links follows to the actor profile, invites to /invites, wishlist events to the list', () => {
    expect(notificationLink(make({ type: 'follow', actorUsername: 'alice' }))).toBe('/users/alice');
    expect(notificationLink(make({ type: 'wishlist_invite' }))).toBe('/invites');
    expect(notificationLink(make({ type: 'invite_accepted', wishlistSlug: 'wedding' }))).toBe(
      '/wishlists/wedding'
    );
    // Falls back to id when there's no slug.
    expect(notificationLink(make({ type: 'proposal', wishlistId: 'abc123' }))).toBe(
      '/wishlists/abc123'
    );
  });

  it('degrades to the notifications page when a link target is missing', () => {
    expect(notificationLink(make({ type: 'follow', actorUsername: null }))).toBe('/notifications');
    expect(notificationLink(make({ type: 'proposal' }))).toBe('/notifications');
  });
});

describe('notificationIcon', () => {
  it('maps each type to an icon', () => {
    expect(notificationIcon(make({ type: 'follow' }))).toBe('user');
    expect(notificationIcon(make({ type: 'wishlist_invite' }))).toBe('inbox');
    expect(notificationIcon(make({ type: 'proposal' }))).toBe('sparkles');
  });
});
