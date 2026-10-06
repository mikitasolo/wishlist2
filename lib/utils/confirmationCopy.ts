/**
 * What leaving, removing and deleting say they do, in one place, so each
 * confirmation and the toast after it describe what the server actually keeps
 * (docs/agents/invariants.md):
 *
 *  - Leaving a list, or being removed from it, frees the items that person
 *    reserved there and keeps their reservations, so the gift stays on their
 *    Reserved page and they can still log it.
 *  - Deleting a list takes its items and everyone's access, and keeps every
 *    reservation and gift log, which are the gifters'.
 *  - Becoming an owner releases what you'd reserved on the list.
 *
 * A count of released or reserved gifts only ever goes back to the gifter
 * themselves (their own leave, their own accept). Nothing an owner reads takes
 * one: owners never see booking status, and "2 gifts released" would tell them
 * how much of the list was reserved.
 */

export interface ConfirmationCopy {
  title: string;
  message: string;
}

const quoted = (name: string) => `“${name}”`;

/** `@username`, or a stand-in for an account that has none. */
const handle = (username: string | null | undefined) => `@${username || 'user'}`;

/** A whole, positive count, or 0 for anything else (a missing or malformed field). */
function positiveCount(count: unknown): number {
  return typeof count === 'number' && Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

/**
 * A member leaving a list. `reservedByYou` is how many of the list's items they
 * hold, from the items the page has loaded, or `null` until it has; with none
 * (or not knowing) the message says what happens to anything they reserved.
 */
export function memberLeaveCopy(
  listName: string,
  reservedByYou: number | null,
  /** Discreet mode is on: no count, only that some are reserved, and only if any are. */
  discreet = false
): ConfirmationCopy {
  const count = positiveCount(reservedByYou);
  if (discreet && count > 0) {
    return {
      title: `Leave ${quoted(listName)}?`,
      message:
        "You'll lose access. Some of your items here are reserved: they go back on the list, but stay on your Reserved page so you can still log them.",
    };
  }
  const reserved =
    count === 0
      ? 'Anything you reserved here goes back on the list, but stays on your Reserved page so you can still log it.'
      : count === 1
        ? 'The gift you reserved here goes back on the list, but stays on your Reserved page so you can still log it.'
        : `The ${count} gifts you reserved here go back on the list, but stay on your Reserved page so you can still log them.`;
  return { title: `Leave ${quoted(listName)}?`, message: `You'll lose access. ${reserved}` };
}

/** A co-owner stepping down. Owners hold no reservations, so there's nothing to say about any. */
export function ownerLeaveCopy(listName: string): ConfirmationCopy {
  return {
    title: `Leave ${quoted(listName)}?`,
    message:
      "You'll stop being an owner and lose access. It comes off your profile and dashboard, and the other owners keep it.",
  };
}

/** What a kick adds when the list has live share links (WIS-338). */
export const KICK_LINKS_SENTENCE = "They won't be able to use this list's share links.";

/**
 * An owner removing someone from the list. Read by an owner, so it takes no
 * count and says nothing about whether this person reserved anything.
 */
export function removeFromListCopy(
  username: string | null | undefined,
  role: 'member' | 'owner',
  /** The list has share links that work (WIS-338): a kick keeps them out of those too. */
  { liveLinks = false }: { liveLinks?: boolean } = {}
): ConfirmationCopy {
  if (role === 'owner') {
    return {
      title: `Remove ${handle(username)} as an owner?`,
      message:
        "They lose access, and it comes off their profile and dashboard. They're told they were removed (not by whom).",
    };
  }
  return {
    title: `Remove ${handle(username)}?`,
    message:
      "They lose access, anything they reserved here goes back on the list, and they're told they were removed (not by whom)." +
      (liveLinks ? ` ${KICK_LINKS_SENTENCE}` : ''),
  };
}

/**
 * An owner deleting a list. `itemCount` is every item on it, drafts and
 * proposals included, since all of them go; `null` until the page has read them.
 */
export function deleteListCopy(listName: string, itemCount: number | null): ConfirmationCopy {
  const what =
    itemCount === null
      ? "Its items and everyone's access go with it."
      : itemCount === 0
        ? "Everyone's access goes with it."
        : `Its ${itemCount} ${itemCount === 1 ? 'item' : 'items'} and everyone's access go with it.`;
  return { title: `Delete ${quoted(listName)}?`, message: `${what} This can't be undone.` };
}

/** The Danger zone's line next to Delete, which says what the dialog will. */
export const DELETE_LIST_WARNING =
  "Deleting this wishlist takes its items and everyone's access with it. This can't be undone.";

/** Settings' Danger zone line next to Delete account (WIS-276). */
export const DELETE_ACCOUNT_WARNING =
  "Erases your account and everything in it at once, including the lists you own alone. This can't be undone.";

/**
 * The account deletion's confirmation. It's the person's own data, so it says
 * plainly that their reservations go (they're the gifter), and that the lists
 * they own alone go with everyone's access. Of anyone else's records it only
 * says, in general, that they stay: never whether there are any.
 */
export const DELETE_ACCOUNT_COPY: ConfirmationCopy = {
  title: 'Delete your account?',
  message:
    "Your profile, photos, follows, notifications, reservations and gift history are erased at once. Items you reserved on other people's lists become available again, and you leave every list you're on or share with other owners. This can't be undone.",
};

/** What the confirmation says about the lists that go with the account. */
export function soleOwnedListsNote(count: number): string {
  if (count === 0) return "You don't own any lists alone, so no list is deleted.";
  return count === 1
    ? 'This list is deleted with it, since you own it alone. Everyone on it loses access, and anyone who reserved something on it keeps their own record:'
    : 'These lists are deleted with it, since you own them alone. Everyone on them loses access, and anyone who reserved something on them keeps their own record:';
}

/**
 * " · 2 gifts you'd reserved here were released", or nothing for none. Only for
 * the gifter's own toast: never append it to anything an owner sees.
 */
export function releasedGiftsNote(count: unknown): string {
  const n = positiveCount(count);
  if (n === 0) return '';
  return n === 1
    ? " · 1 gift you'd reserved here was released"
    : ` · ${n} gifts you'd reserved here were released`;
}

/**
 * The invitee's toast once they've accepted. Accepting an owner invite ends
 * every reservation they held on the list, so it counts those
 * (`cancelledReservations` in the accept's answer): that's what goes from their
 * Reserved page. It can be more than the items it freed (`releasedBookings`),
 * since a reservation outlives its item being drafted or completed, or its
 * holder leaving the list.
 */
export function acceptedInviteToast(
  role: 'owner' | 'member',
  listName: string,
  cancelledReservations: unknown
): string {
  const joined =
    role === 'owner'
      ? `You're now a co-owner of ${quoted(listName)}`
      : `Joined ${quoted(listName)}`;
  return joined + releasedGiftsNote(cancelledReservations);
}

/**
 * The invitee's toast when their answer finds the invite already answered, from
 * another tab or device (the invite route's 409, WIS-100). It names the list
 * from their own invite card, and says nothing of reservations: whatever that
 * earlier accept released, its own toast said.
 */
export function alreadyAnsweredInviteToast(
  answer: 'accepted' | 'declined',
  listName: string
): string {
  return answer === 'accepted'
    ? `You've already joined ${quoted(listName)}`
    : 'You already declined this invitation';
}

/** The leaver's toast (`unbookedItemsCount` in the leave's answer). */
export function leftListToast(
  listName: string | null | undefined,
  unbookedItemsCount: unknown
): string {
  const left = listName ? `You left ${quoted(listName)}` : 'You left the wishlist';
  return left + releasedGiftsNote(unbookedItemsCount);
}
