import { describe, it, expect } from 'vitest';
import {
  NOTIFICATION_TYPES,
  notificationParts,
  notificationText,
  notificationLink,
  notificationIcon,
  showsActor,
  isGroupFollow,
  followBackTarget,
  withInviteAnswers,
  type NotificationView,
} from '@/lib/utils/notifications';
import { FOLLOWERS_PARAM, followersHref } from '@/lib/utils/profileLinks';

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

describe('notificationText — role changes', () => {
  it('tells a demoted owner they are now a member', () => {
    expect(notificationText(make({ type: 'role_changed', wishlistName: 'Family list' }))).toBe(
      'You’re now a member of Family list'
    );
  });

  it('tells a removed owner or kicked member they were removed', () => {
    expect(
      notificationText(make({ type: 'removed_from_wishlist', wishlistName: 'Family list' }))
    ).toBe('You were removed from Family list');
  });

  it('falls back when the list name is missing, without quoting the fallback', () => {
    expect(notificationText(make({ type: 'role_changed' }))).toBe(
      'You’re now a member of a wishlist'
    );
    expect(notificationText(make({ type: 'removed_from_wishlist' }))).toBe(
      'You were removed from a wishlist'
    );
  });

  // Neutral on purpose: neither names the owner who made the change, whatever
  // actor a row carries, and neither mentions bookings.
  it('never names who made the change', () => {
    for (const type of ['role_changed', 'removed_from_wishlist'] as const) {
      const text = notificationText(
        make({ type, actorUsername: 'should-not-appear', wishlistName: 'Family list' })
      );
      expect(text).not.toContain('should-not-appear');
      expect(text).not.toMatch(/book|item/i);
    }
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
      '2 new proposals on Kitchen'
    );
    expect(notificationText(make({ type: 'proposal', count: 5, wishlistName: 'Kitchen' }))).toBe(
      '5 new proposals on Kitchen'
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
  it('links follows to the actor profile, wishlist events to the list, and a pending invite nowhere', () => {
    expect(notificationLink(make({ type: 'follow', actorUsername: 'alice' }))).toBe('/users/alice');
    // Answered on its card, pinned above the feed on the same page.
    expect(notificationLink(make({ type: 'wishlist_invite' }))).toBeNull();
    expect(notificationLink(make({ type: 'invite_accepted', wishlistSlug: 'wedding' }))).toBe(
      '/wishlists/wedding'
    );
    // Falls back to id when there's no slug.
    expect(notificationLink(make({ type: 'proposal', wishlistId: 'abc123' }))).toBe(
      '/wishlists/abc123'
    );
  });

  // regression: a follow row for several people linked to the dashboard (`/`),
  // which neither lists your followers nor says who followed you.
  it('regression: links a single follow to the follower, several to your own followers', () => {
    expect(
      notificationLink(
        make({ type: 'follow', count: 1, actorUsername: 'alice', actorUsernames: ['alice'] }),
        'me'
      )
    ).toBe('/users/alice');
    expect(
      notificationLink(
        make({ type: 'follow', count: 2, actorUsername: 'bob', actorUsernames: ['alice', 'bob'] }),
        'me'
      )
    ).toBe('/users/me?followers=1');
    expect(
      notificationLink(
        make({
          type: 'follow',
          count: 5,
          actorUsername: 'eve',
          actorUsernames: ['cat', 'dan', 'eve'],
        }),
        'me'
      )
    ).toBe('/users/me?followers=1');
  });

  it('builds the followers link the profile page opens its followers list from', () => {
    const href = notificationLink(make({ type: 'follow', count: 3 }), 'me');
    expect(href).toBe(followersHref('me'));
    expect(new URL(href!, 'http://x').searchParams.has(FOLLOWERS_PARAM)).toBe(true);
  });

  it('links a follow by someone with no username to your followers', () => {
    expect(notificationLink(make({ type: 'follow', actorUsername: null }), 'me')).toBe(
      '/users/me?followers=1'
    );
  });

  it('links proposals to the list whatever the count', () => {
    for (const count of [1, 2, 5]) {
      expect(notificationLink(make({ type: 'proposal', count, wishlistSlug: 'kitchen' }))).toBe(
        '/wishlists/kitchen'
      );
    }
  });

  it('links a demotion to the list, which they can still open as a member', () => {
    expect(
      notificationLink(make({ type: 'role_changed', wishlistSlug: 'family', wishlistId: 'w1' }))
    ).toBe('/wishlists/family');
    expect(notificationLink(make({ type: 'role_changed', wishlistId: 'w1' }))).toBe(
      '/wishlists/w1'
    );
    expect(notificationLink(make({ type: 'role_changed' }))).toBe('/notifications');
  });

  it('never links a removal anywhere, since the list may be hidden from them now', () => {
    expect(
      notificationLink(
        make({ type: 'removed_from_wishlist', wishlistSlug: 'family', wishlistId: 'w1' })
      )
    ).toBeNull();
    expect(notificationLink(make({ type: 'removed_from_wishlist' }))).toBeNull();
  });

  it('degrades to the notifications page when a link target is missing', () => {
    // A follow it can't name, and no username of the viewer's own to link to.
    expect(notificationLink(make({ type: 'follow', actorUsername: null }))).toBe('/notifications');
    expect(notificationLink(make({ type: 'follow', count: 2, actorUsername: 'bob' }), null)).toBe(
      '/notifications'
    );
    expect(notificationLink(make({ type: 'proposal' }))).toBe('/notifications');
  });
});

describe('an invite to co-own a list', () => {
  const invite = (inviteRole: NotificationView['inviteRole']) =>
    make({
      type: 'wishlist_invite',
      actorUsername: 'chloe_r',
      wishlistName: 'Garden',
      wishlistId: 'w1',
      inviteRole,
    });

  it('says co-own on an owner invite', () => {
    expect(notificationText(invite('owner'))).toBe('@chloe_r invited you to co-own Garden');
    expect(notificationParts(invite('owner'))).toEqual([
      '@chloe_r invited you to co-own ',
      { listName: 'Garden' },
    ]);
  });

  it('reads as a plain invite as a member, or on a row from before the role was recorded', () => {
    for (const role of ['member', null, undefined] as const) {
      expect(notificationText(invite(role))).toBe('@chloe_r invited you to Garden');
    }
  });

  it('reads as the answer once answered, whatever the role', () => {
    expect(notificationText({ ...invite('owner'), inviteAnswer: 'accepted' })).toBe(
      'You joined Garden'
    );
  });
});

describe('an answered invite', () => {
  const invite = (inviteAnswer: NotificationView['inviteAnswer']) =>
    make({
      type: 'wishlist_invite',
      actorUsername: 'ben',
      wishlistName: 'Ben’s housewarming',
      wishlistId: 'w1',
      inviteAnswer,
    });

  it('reads as an invite while it is pending, linking nowhere: its card above answers it', () => {
    for (const pending of [null, undefined]) {
      expect(notificationText(invite(pending))).toBe('@ben invited you to Ben’s housewarming');
      expect(notificationLink(invite(pending))).toBeNull();
    }
  });

  // regression: an answered invite still read "@ben invited you to …" and linked
  // to /invites, which no longer had it.
  it('regression: reads "You joined …" once accepted, and links to the list', () => {
    expect(notificationText(invite('accepted'))).toBe('You joined Ben’s housewarming');
    expect(notificationLink(invite('accepted'))).toBe('/wishlists/w1');
    expect(notificationLink({ ...invite('accepted'), wishlistSlug: 'bens-housewarming' })).toBe(
      '/wishlists/bens-housewarming'
    );
  });

  it('regression: reads "You declined the invite to …" once declined, and links nowhere', () => {
    expect(notificationText(invite('declined'))).toBe(
      'You declined the invite to Ben’s housewarming'
    );
    expect(notificationLink(invite('declined'))).toBeNull();
  });

  it('no longer names the inviter once answered', () => {
    for (const answer of ['accepted', 'declined'] as const) {
      expect(notificationText(invite(answer))).not.toContain('@ben');
    }
  });

  it('falls back to "a wishlist" without a name', () => {
    expect(notificationText({ ...invite('accepted'), wishlistName: null })).toBe(
      'You joined a wishlist'
    );
  });
});

describe('notificationParts — list names', () => {
  const name = 'Anna’s 30th Birthday';
  const everyType = (overrides: Partial<NotificationView>) =>
    // A follow, a friend's birthday and an ask for a list are about a person, never a list.
    NOTIFICATION_TYPES.filter(
      (type) => type !== 'follow' && type !== 'birthday_reminder' && type !== 'wishlist_ask'
    ).flatMap((type) =>
      [1, 2].map((count) => make({ type, count, actorUsername: 'ann', ...overrides }))
    );

  // regression: some types quoted the list's name («on “Anna’s 30th Birthday”»)
  // and others didn't («invited you to Ben’s housewarming»).
  it('regression: sets every list name apart the same way, never quoted', () => {
    const rows = [
      ...everyType({ wishlistName: name }),
      ...(['accepted', 'declined'] as const).map((inviteAnswer) =>
        make({ type: 'wishlist_invite', wishlistName: name, inviteAnswer })
      ),
    ];
    for (const n of rows) {
      const parts = notificationParts(n);
      // Exactly one piece is the list's name, as it is.
      expect(parts.filter((p) => typeof p !== 'string')).toEqual([{ listName: name }]);
      // And no quote mark wraps it in the plain-text line.
      const text = notificationText(n);
      expect(text).toContain(name);
      expect(text).not.toMatch(/[“”"«]Anna’s 30th Birthday|Anna’s 30th Birthday[“”"»]/);
    }
  });

  it('sets nothing apart when the row has no list name', () => {
    for (const n of everyType({ wishlistName: null })) {
      expect(notificationParts(n).every((p) => typeof p === 'string')).toBe(true);
    }
    expect(notificationParts(make({ type: 'follow', actorUsername: 'ann' }))).toEqual([
      '@ann followed you',
    ]);
  });

  // An item's name isn't a list's: it keeps its quotes.
  it('still quotes an approved proposal’s item name', () => {
    expect(
      notificationParts(
        make({ type: 'proposal_approved', itemName: 'Kettle', wishlistName: 'Kitchen' })
      )
    ).toEqual(['Your proposed item “Kettle” was accepted in ', { listName: 'Kitchen' }]);
  });

  // Anonymity holds in the pieces too, not only in the joined text.
  it('never names a proposer, a demoting or a removing owner in any piece', () => {
    for (const type of ['proposal', 'role_changed', 'removed_from_wishlist'] as const) {
      for (const count of [1, 3]) {
        const parts = notificationParts(
          make({
            type,
            count,
            actorUsername: 'should-not-appear',
            actorUsernames: ['should-not-appear'],
            wishlistName: 'Kitchen',
          })
        );
        expect(JSON.stringify(parts)).not.toContain('should-not-appear');
      }
    }
  });
});

describe('notificationIcon', () => {
  it('maps each type to an icon', () => {
    expect(notificationIcon(make({ type: 'follow' }))).toBe('user');
    expect(notificationIcon(make({ type: 'wishlist_invite' }))).toBe('inbox');
    expect(notificationIcon(make({ type: 'proposal' }))).toBe('sparkles');
    expect(notificationIcon(make({ type: 'role_changed' }))).toBe('users');
    expect(notificationIcon(make({ type: 'removed_from_wishlist' }))).toBe('logout');
  });
});

describe('showsActor', () => {
  it('shows who did it on a follow, an invite, an accepted invite, a request to join, a link join, whose birthday it is and who asked for or made a list only', () => {
    expect(NOTIFICATION_TYPES.filter(showsActor)).toEqual([
      'follow',
      'wishlist_invite',
      'invite_accepted',
      'join_request',
      'link_join',
      'birthday_reminder',
      'wishlist_ask',
      'asked_list_made',
    ]);
  });

  // Proposals are anonymous to the owners; a demotion or a removal never says
  // which owner made it; an approved proposal carries no actor.
  it('never shows one on a proposal, a demotion, a removal or an approved proposal', () => {
    for (const type of [
      'proposal',
      'role_changed',
      'removed_from_wishlist',
      'proposal_approved',
    ] as const) {
      expect(showsActor(type)).toBe(false);
    }
  });
});

describe('follow rows', () => {
  const one = (overrides: Partial<NotificationView> = {}) =>
    make({ type: 'follow', actorUsername: 'gus', actorId: 'u-gus', ...overrides });

  it('tells a follow by several people (or one it can’t name) from a follow by one', () => {
    expect(isGroupFollow(one())).toBe(false);
    expect(isGroupFollow(one({ count: 3 }))).toBe(true);
    expect(isGroupFollow(one({ actorUsername: null }))).toBe(true);
    expect(isGroupFollow(make({ type: 'invite_accepted', count: 3 }))).toBe(false);
  });

  it('offers Follow back only to one follower you don’t follow yet', () => {
    expect(followBackTarget(one({ followingActor: false }))).toBe('u-gus');
    expect(followBackTarget(one({ followingActor: true }))).toBeNull();
    // Not known (an older server's answer): no offer, rather than a wrong one.
    expect(followBackTarget(one({ followingActor: undefined }))).toBeNull();
    expect(followBackTarget(one({ followingActor: false, actorId: null }))).toBeNull();
    expect(followBackTarget(one({ followingActor: false, count: 2 }))).toBeNull();
    expect(
      followBackTarget(make({ type: 'invite_accepted', actorId: 'u-gus', followingActor: false }))
    ).toBeNull();
  });
});

describe('withInviteAnswers', () => {
  const pending = (overrides: Partial<NotificationView> = {}) =>
    make({
      type: 'wishlist_invite',
      actorUsername: 'ben',
      wishlistId: 'w1',
      wishlistName: 'Garden',
      createdAt: '2026-05-02T00:00:00.000Z',
      ...overrides,
    });

  it('turns the answered invite’s row into the answer, and marks it read', () => {
    const [row] = withInviteAnswers([pending()], [{ wishlistId: 'w1', answer: 'accepted' }]);
    expect(row).toMatchObject({ inviteAnswer: 'accepted', read: true });
    expect(notificationText(row)).toBe('You joined Garden');
  });

  it('leaves other lists, other types and rows already answered as they are', () => {
    const rows = [
      pending({ _id: 'other', wishlistId: 'w2' }),
      make({ _id: 'joined', type: 'invite_accepted', wishlistId: 'w1' }),
      pending({ _id: 'declined', inviteAnswer: 'declined' }),
    ];
    expect(withInviteAnswers(rows, [{ wishlistId: 'w1', answer: 'accepted' }])).toEqual(rows);
  });

  // As recordInviteAnswer does: a row older than the invite was about an
  // earlier one, which was answered or cancelled before this one was issued.
  it('leaves a row older than the invite alone', () => {
    const older = pending({ createdAt: '2026-05-01T00:00:00.000Z' });
    const answers = [
      { wishlistId: 'w1', answer: 'declined' as const, since: '2026-05-01T12:00:00.000Z' },
    ];
    expect(withInviteAnswers([older], answers)).toEqual([older]);
    expect(withInviteAnswers([pending()], answers)[0].inviteAnswer).toBe('declined');
  });
});

describe('a request to join (WIS-275)', () => {
  const request = (over: Partial<NotificationView> = {}) =>
    make({
      type: 'join_request',
      actorUsername: 'ivan_petrov',
      wishlistName: 'Anna’s 30th',
      wishlistSlug: 'anna-30',
      wishlistId: 'w1',
      ...over,
    });

  it('names the requester by handle and the list', () => {
    expect(notificationText(request())).toBe('@ivan_petrov asked to join Anna’s 30th');
    expect(notificationParts(request())).toEqual([
      '@ivan_petrov asked to join ',
      { listName: 'Anna’s 30th' },
    ]);
  });

  it('links to the list’s People tab, where it’s answered', () => {
    expect(notificationLink(request())).toBe('/wishlists/anna-30?tab=people');
    expect(notificationLink(request({ wishlistSlug: null }))).toBe('/wishlists/w1?tab=people');
    expect(notificationIcon(request())).toBe('user-plus');
  });
});

describe('a link join (WIS-337)', () => {
  const join = (over: Partial<NotificationView> = {}) =>
    make({
      type: 'link_join',
      actorUsername: 'ivan_petrov',
      wishlistName: 'Anna’s 30th',
      wishlistSlug: 'anna-30',
      wishlistId: 'w1',
      linkLabel: null,
      ...over,
    });

  it('names who joined, the list, and the link by its label when it has one', () => {
    expect(notificationText(join())).toBe('@ivan_petrov joined Anna’s 30th through a link');
    expect(notificationParts(join({ linkLabel: 'Family chat' }))).toEqual([
      '@ivan_petrov joined ',
      { listName: 'Anna’s 30th' },
      ' through the link “Family chat”',
    ]);
    expect(notificationText(join({ actorUsername: null }))).toBe(
      'Someone joined Anna’s 30th through a link'
    );
  });

  it('links to the list’s People tab', () => {
    expect(notificationLink(join())).toBe('/wishlists/anna-30?tab=people');
    expect(notificationLink(join({ wishlistSlug: null }))).toBe('/wishlists/w1?tab=people');
    expect(notificationIcon(join())).toBe('link');
  });
});

describe('occasion reminder', () => {
  const reminder = (over: Partial<NotificationView> = {}) =>
    make({
      type: 'occasion_reminder',
      wishlistName: 'Anna’s 30th',
      wishlistSlug: 'anna-30',
      wishlistId: 'w1',
      occasionKind: 'birthday',
      occasionDate: '2026-10-17',
      ...over,
    });

  it('names the kind, the day and the list, and nothing about bookings', () => {
    const parts = notificationParts(reminder());
    expect(parts).toHaveLength(2);
    expect(parts[0]).toMatch(/^Birthday coming up on .*17.*: $/);
    expect(parts[1]).toEqual({ listName: 'Anna’s 30th' });
    expect(notificationText(reminder())).not.toMatch(/reserv|book|left|item/i);
  });

  it('reads plainly without a known kind or day', () => {
    expect(notificationText(reminder({ occasionKind: 'other' }))).toMatch(
      /^An occasion coming up on /
    );
    expect(notificationText(reminder({ occasionKind: null, occasionDate: null }))).toBe(
      'An occasion coming up: Anna’s 30th'
    );
    expect(notificationText(reminder({ occasionDate: 'not-a-date' }))).toBe(
      'Birthday coming up: Anna’s 30th'
    );
  });

  it('links to the list, with a calendar icon and no actor', () => {
    expect(notificationLink(reminder())).toBe('/wishlists/anna-30');
    expect(notificationIcon(reminder())).toBe('calendar');
    expect(showsActor('occasion_reminder')).toBe(false);
  });
});

describe('birthday reminder (WIS-345)', () => {
  const reminder = (over: Partial<NotificationView> = {}) =>
    make({
      type: 'birthday_reminder',
      actorUsername: 'anna',
      occasionDate: '2027-03-14',
      ...over,
    });

  it('names whose birthday and its day, with no year, list, item or booking', () => {
    const parts = notificationParts(reminder());
    expect(parts).toHaveLength(1);
    expect(parts.every((p) => typeof p === 'string')).toBe(true);
    const text = notificationText(reminder());
    expect(text).toMatch(/^@anna’s birthday is on /);
    expect(text).toMatch(/14/);
    expect(text).not.toMatch(/2027|list|reserv|book|item/i);
  });

  it('never names a list, even on a row that somehow carries one', () => {
    const text = notificationText(reminder({ wishlistName: 'Anna’s 30th', wishlistId: 'w1' }));
    expect(text).not.toContain('Anna’s 30th');
  });

  it('reads plainly without a day or a name', () => {
    expect(notificationText(reminder({ occasionDate: null }))).toBe(
      '@anna’s birthday is coming up'
    );
    expect(notificationText(reminder({ actorUsername: null, occasionDate: 'x' }))).toBe(
      'A friend’s birthday is coming up'
    );
  });

  it('links to their profile, with a gift icon and their face', () => {
    expect(notificationLink(reminder())).toBe('/users/anna');
    expect(notificationLink(reminder({ actorUsername: null }))).toBe('/notifications');
    expect(notificationIcon(reminder())).toBe('gift');
    expect(showsActor('birthday_reminder')).toBe(true);
  });
});

describe('asking a friend for a wishlist (WIS-324)', () => {
  it('tells the person who asked, and links to the asker’s profile', () => {
    const n = make({ type: 'wishlist_ask', actorUsername: 'ivan' });
    expect(notificationText(n)).toBe('@ivan wants to know what you’d like');
    expect(notificationLink(n)).toBe('/users/ivan');
    // About a person, never a list.
    expect(notificationParts(n).every((p) => typeof p === 'string')).toBe(true);
  });

  it('tells an asker which list was made, and links to it', () => {
    const n = make({
      type: 'asked_list_made',
      actorUsername: 'anna',
      wishlistName: 'Birthday',
      wishlistSlug: 'birthday',
    });
    expect(notificationParts(n)).toEqual([
      '@anna made a wishlist you asked for: ',
      { listName: 'Birthday' },
    ]);
    expect(notificationLink(n)).toBe('/wishlists/birthday');
  });

  it('never assumes a name', () => {
    expect(notificationText(make({ type: 'wishlist_ask', actorUsername: null }))).toBe(
      'Someone wants to know what you’d like'
    );
  });
});
