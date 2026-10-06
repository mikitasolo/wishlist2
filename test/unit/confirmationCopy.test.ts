import { describe, it, expect } from 'vitest';
import {
  DELETE_LIST_WARNING,
  acceptedInviteToast,
  alreadyAnsweredInviteToast,
  deleteListCopy,
  leftListToast,
  memberLeaveCopy,
  ownerLeaveCopy,
  releasedGiftsNote,
  removeFromListCopy,
} from '@/lib/utils/confirmationCopy';

describe('memberLeaveCopy in discreet mode (WIS-46)', () => {
  it('gives no count, and warns only when they hold at least one', () => {
    for (const count of [1, 3]) {
      const { message } = memberLeaveCopy('Camping trip', count, true);
      expect(message).toBe(
        "You'll lose access. Some of your items here are reserved: they go back on the list, but stay on your Reserved page so you can still log them."
      );
    }
    for (const count of [0, null]) {
      expect(memberLeaveCopy('Camping trip', count, true).message).toBe(
        memberLeaveCopy('Camping trip', count).message
      );
    }
  });
});

describe('memberLeaveCopy', () => {
  // regression: a member's leave said "All your bookings will be removed".
  // Leaving frees the items and keeps the reservations.
  it('regression: says reservations stay on the Reserved page, never that they are removed', () => {
    for (const count of [null, 0, 1, 3]) {
      const { title, message } = memberLeaveCopy('Camping trip', count);
      expect(title).toBe('Leave “Camping trip”?');
      expect(message).toMatch(/^You'll lose access\. /);
      expect(message).toContain('Reserved page');
      expect(message).not.toMatch(/removed|deleted|cancel/i);
    }
  });

  it('counts their own reserved gifts when the page knows them', () => {
    expect(memberLeaveCopy('Camping trip', 3).message).toBe(
      "You'll lose access. The 3 gifts you reserved here go back on the list, but stay on your Reserved page so you can still log them."
    );
    expect(memberLeaveCopy('Camping trip', 1).message).toBe(
      "You'll lose access. The gift you reserved here goes back on the list, but stays on your Reserved page so you can still log it."
    );
  });

  it('speaks of anything they reserved with none, or before the items are read', () => {
    const generic =
      "You'll lose access. Anything you reserved here goes back on the list, but stays on your Reserved page so you can still log it.";
    expect(memberLeaveCopy('Camping trip', 0).message).toBe(generic);
    expect(memberLeaveCopy('Camping trip', null).message).toBe(generic);
  });
});

describe('the copy an owner reads', () => {
  // Owners never see booking status: none of these take a count, and none say
  // whether this person reserved anything.
  it('removing a member says what they lose and that they are told, not by whom', () => {
    expect(removeFromListCopy('ben_carter', 'member')).toEqual({
      title: 'Remove @ben_carter?',
      message:
        "They lose access, anything they reserved here goes back on the list, and they're told they were removed (not by whom).",
    });
  });

  it('removing a co-owner says the same, without reservations, which owners never hold', () => {
    expect(removeFromListCopy('bob', 'owner')).toEqual({
      title: 'Remove @bob as an owner?',
      message:
        "They lose access, and it comes off their profile and dashboard. They're told they were removed (not by whom).",
    });
  });

  it('a kick says the person can’t use the list’s share links only when it has live ones (WIS-338)', () => {
    expect(removeFromListCopy('ben', 'member', { liveLinks: true }).message).toBe(
      "They lose access, anything they reserved here goes back on the list, and they're told they were removed (not by whom). They won't be able to use this list's share links."
    );
    expect(removeFromListCopy('ben', 'member', { liveLinks: false }).message).not.toContain(
      'share links'
    );
    // Removing an owner leaves the links working for them: the prompt after it asks instead.
    expect(removeFromListCopy('bob', 'owner', { liveLinks: true }).message).not.toContain(
      'share links'
    );
  });

  it('names someone without a username as @user, as the rows do', () => {
    expect(removeFromListCopy(null, 'member').title).toBe('Remove @user?');
  });

  it('a co-owner leaving is told what they lose, with nothing about reservations', () => {
    const { title, message } = ownerLeaveCopy('Birthday');
    expect(title).toBe('Leave “Birthday”?');
    expect(message).not.toMatch(/\d|reserv|book/i);
  });

  it('none of them carries a digit', () => {
    for (const { title, message } of [
      removeFromListCopy('ben', 'member'),
      removeFromListCopy('ben', 'owner'),
      ownerLeaveCopy('List'),
    ]) {
      expect(title + message).not.toMatch(/\d/);
    }
  });
});

describe('deleteListCopy', () => {
  // regression: the dialog said bookings "will be permanently deleted", and
  // deleting a list keeps every reservation on purpose.
  it('regression: says its items and everyone’s access go, and nothing about bookings', () => {
    expect(deleteListCopy("Anna's 30th Birthday", 15)).toEqual({
      title: "Delete “Anna's 30th Birthday”?",
      message: "Its 15 items and everyone's access go with it. This can't be undone.",
    });
    for (const count of [null, 0, 1, 15]) {
      expect(deleteListCopy('List', count).message).not.toMatch(/book|reserv/i);
    }
  });

  it('counts one item in the singular, leaves out none, and says "its items" before the read', () => {
    expect(deleteListCopy('List', 1).message).toBe(
      "Its 1 item and everyone's access go with it. This can't be undone."
    );
    expect(deleteListCopy('List', 0).message).toBe(
      "Everyone's access goes with it. This can't be undone."
    );
    expect(deleteListCopy('List', null).message).toBe(
      "Its items and everyone's access go with it. This can't be undone."
    );
  });

  it('agrees with the Danger zone', () => {
    expect(DELETE_LIST_WARNING).toMatch(/items and everyone's access/);
    expect(DELETE_LIST_WARNING).toMatch(/This can't be undone\.$/);
    expect(DELETE_LIST_WARNING).not.toMatch(/book|reserv|membership/i);
  });
});

describe('releasedGiftsNote', () => {
  it('counts the released gifts, in the singular for one', () => {
    expect(releasedGiftsNote(2)).toBe(" · 2 gifts you'd reserved here were released");
    expect(releasedGiftsNote(1)).toBe(" · 1 gift you'd reserved here was released");
  });

  it('says nothing for none, or for a count that is missing or malformed', () => {
    for (const count of [0, -1, undefined, null, NaN, Infinity, '2', {}]) {
      expect(releasedGiftsNote(count)).toBe('');
    }
  });
});

describe('the toasts back to the gifter', () => {
  it('an accepted co-owner invite says they are a co-owner, with the reservations it ended', () => {
    expect(acceptedInviteToast('owner', 'Garden', 2)).toBe(
      "You're now a co-owner of “Garden” · 2 gifts you'd reserved here were released"
    );
    expect(acceptedInviteToast('owner', 'Garden', 0)).toBe("You're now a co-owner of “Garden”");
    expect(acceptedInviteToast('owner', 'Garden', undefined)).toBe(
      "You're now a co-owner of “Garden”"
    );
  });

  it('an accepted member invite says they joined', () => {
    expect(acceptedInviteToast('member', 'Garden', 0)).toBe('Joined “Garden”');
  });

  it('leaving says they left, with what it released', () => {
    expect(leftListToast('Camping trip', 3)).toBe(
      "You left “Camping trip” · 3 gifts you'd reserved here were released"
    );
    expect(leftListToast('Camping trip', 0)).toBe('You left “Camping trip”');
    expect(leftListToast(undefined, undefined)).toBe('You left the wishlist');
  });
});

describe('alreadyAnsweredInviteToast', () => {
  it('names the list they already joined, and says nothing of reservations', () => {
    expect(alreadyAnsweredInviteToast('accepted', 'Garden')).toBe("You've already joined “Garden”");
  });

  it('says they already declined it', () => {
    expect(alreadyAnsweredInviteToast('declined', 'Garden')).toBe(
      'You already declined this invitation'
    );
  });
});
