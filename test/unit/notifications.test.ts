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
    count: 1,
    actorUsernames: [],
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
      '@alice followed you'
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
      'Someone followed you'
    );
  });
});

describe('notificationText — coalesced rows', () => {
  // A coalesced follow row keeps the latest 3 actors, oldest first; the last
  // one is also `actorUsername`.
  it('names one, two, or the latest follower and a count', () => {
    expect(
      notificationText(
        make({ type: 'follow', count: 1, actorUsername: 'alice', actorUsernames: ['alice'] })
      )
    ).toBe('@alice followed you');
    expect(
      notificationText(
        make({ type: 'follow', count: 2, actorUsername: 'bob', actorUsernames: ['alice', 'bob'] })
      )
    ).toBe('@bob and @alice followed you');
    expect(
      notificationText(
        make({
          type: 'follow',
          count: 5,
          actorUsername: 'eve',
          actorUsernames: ['cat', 'dan', 'eve'],
        })
      )
    ).toBe('@eve and 4 others followed you');
  });

  it('counts the rest when it can name only one, and says "1 other" in the singular', () => {
    expect(
      notificationText(
        make({ type: 'follow', count: 3, actorUsername: 'cat', actorUsernames: ['bob', 'cat'] })
      )
    ).toBe('@cat and 2 others followed you');
    // Two follows, but one follower had no username to record.
    expect(
      notificationText(
        make({ type: 'follow', count: 2, actorUsername: 'bob', actorUsernames: ['bob'] })
      )
    ).toBe('@bob and 1 other followed you');
    expect(notificationText(make({ type: 'follow', count: 3, actorUsernames: [] }))).toBe(
      '3 people followed you'
    );
  });

  it('reads a row from before coalescing (no count, no actor list) as one event', () => {
    const legacy = make({ type: 'follow', actorUsername: 'alice' });
    delete legacy.count;
    delete legacy.actorUsernames;
    expect(notificationText(legacy)).toBe('@alice followed you');
    expect(notificationLink(legacy)).toBe('/users/alice');
  });

  it('counts proposals on a list', () => {
    expect(notificationText(make({ type: 'proposal', count: 1, wishlistName: 'Kitchen' }))).toBe(
      'Someone proposed an item for Kitchen'
    );
    expect(notificationText(make({ type: 'proposal', count: 2, wishlistName: 'Kitchen' }))).toBe(
      '2 new proposals on “Kitchen”'
    );
    expect(notificationText(make({ type: 'proposal', count: 5, wishlistName: 'Kitchen' }))).toBe(
      '5 new proposals on “Kitchen”'
    );
    expect(notificationText(make({ type: 'proposal', count: 5 }))).toBe(
      '5 new proposals on a wishlist'
    );
  });

  // regression: proposals are anonymous to the owner. A coalesced proposal row
  // must stay anonymous too, even if an actor somehow reached it.
  it('never names a proposer, however many proposals a row counts', () => {
    for (const count of [1, 2, 5]) {
      const text = notificationText(
        make({
          type: 'proposal',
          count,
          actorUsername: 'should-not-appear',
          actorUsernames: ['also-hidden', 'should-not-appear'],
          wishlistName: 'Kitchen',
        })
      );
      expect(text).not.toContain('should-not-appear');
      expect(text).not.toContain('also-hidden');
    }
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

  it('links a single follow to the follower, several to your followers on the dashboard', () => {
    expect(
      notificationLink(
        make({ type: 'follow', count: 1, actorUsername: 'alice', actorUsernames: ['alice'] })
      )
    ).toBe('/users/alice');
    expect(
      notificationLink(
        make({ type: 'follow', count: 2, actorUsername: 'bob', actorUsernames: ['alice', 'bob'] })
      )
    ).toBe('/');
    expect(
      notificationLink(
        make({
          type: 'follow',
          count: 5,
          actorUsername: 'eve',
          actorUsernames: ['cat', 'dan', 'eve'],
        })
      )
    ).toBe('/');
  });

  it('links proposals to the list whatever the count', () => {
    for (const count of [1, 2, 5]) {
      expect(notificationLink(make({ type: 'proposal', count, wishlistSlug: 'kitchen' }))).toBe(
        '/wishlists/kitchen'
      );
    }
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
