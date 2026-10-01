import type { IconName } from '@/components/Icon';

// The one list of notification types: the model's enum is built from it too.
export const NOTIFICATION_TYPES = [
  'follow',
  'wishlist_invite',
  'invite_accepted',
  'proposal',
  'proposal_approved',
  'role_changed',
  'removed_from_wishlist',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

// The client-facing shape (ids stringified) returned by /api/notifications.
export interface NotificationView {
  _id: string;
  type: NotificationType;
  // The latest actor (null when hidden, e.g. on a proposal).
  actorUsername: string | null;
  // How many events this row stands for; above 1 it's a coalesced burst.
  // Optional, like `actorUsernames`: a response from a server older than
  // coalescing has neither, and each of its rows is one event.
  count?: number;
  // Coalesced follows: the latest few actors, oldest first. Empty otherwise.
  actorUsernames?: string[];
  wishlistName: string | null;
  wishlistSlug: string | null;
  wishlistId: string | null;
  itemName: string | null;
  read: boolean;
  createdAt: string;
}

const actor = (n: NotificationView) => (n.actorUsername ? `@${n.actorUsername}` : 'Someone');
const list = (n: NotificationView) => n.wishlistName ?? 'a wishlist';
const quotedList = (n: NotificationView) => (n.wishlistName ? `“${n.wishlistName}”` : 'a wishlist');
const countOf = (n: NotificationView) => Math.max(1, n.count ?? 1);

/** "@alice followed you" / "@bob and @alice followed you" / "@bob and 3 others followed you". */
function followText(n: NotificationView): string {
  const count = countOf(n);
  // Latest first; a row from before coalescing only has its single actor.
  const names = (n.actorUsernames?.length ? [...n.actorUsernames].reverse() : [n.actorUsername])
    .filter((name): name is string => !!name)
    .map((name) => `@${name}`);
  const [latest, previous] = names;
  if (!latest) return count === 1 ? 'Someone followed you' : `${count} people followed you`;
  if (count === 1) return `${latest} followed you`;
  if (count === 2 && previous) return `${latest} and ${previous} followed you`;
  const others = count - 1;
  return `${latest} and ${others} ${others === 1 ? 'other' : 'others'} followed you`;
}

/** Human-readable line for a notification. Never assumes a non-null actor. */
export function notificationText(n: NotificationView): string {
  switch (n.type) {
    case 'follow':
      return followText(n);
    case 'wishlist_invite':
      return `${actor(n)} invited you to ${list(n)}`;
    case 'invite_accepted':
      return `${actor(n)} accepted your invitation to ${list(n)}`;
    case 'proposal':
      // Deliberately anonymous — owners must never learn who proposed an item,
      // so neither form reads an actor field.
      if (countOf(n) > 1) return `${countOf(n)} new proposals on ${quotedList(n)}`;
      return `Someone proposed an item for ${list(n)}`;
    case 'proposal_approved':
      return n.itemName
        ? `Your proposed item “${n.itemName}” was accepted in ${list(n)}`
        : `Your proposed item was accepted in ${list(n)}`;
    // Neither names who made the change (neutral, so it can't set co-owners
    // against each other; members can't see the members list anyway), and
    // neither mentions bookings: a released-booking count only ever goes back to
    // the gifter on their own actions.
    case 'role_changed':
      return `You’re now a member of ${quotedList(n)}`;
    case 'removed_from_wishlist':
      return `You were removed from ${quotedList(n)}`;
    default:
      return 'You have a new notification';
  }
}

/**
 * Where clicking a notification should take the user, or null when it shouldn't
 * link anywhere: after a removal the list may no longer be visible to them.
 */
export function notificationLink(n: NotificationView): string | null {
  switch (n.type) {
    case 'follow':
      // Several followers: the dashboard, where your follower count opens the
      // list (the list itself has no URL to link to).
      if (countOf(n) > 1) return '/';
      return n.actorUsername ? `/users/${n.actorUsername}` : '/notifications';
    case 'wishlist_invite':
      return '/invites';
    case 'invite_accepted':
    case 'proposal':
    case 'proposal_approved':
    case 'role_changed':
      return n.wishlistSlug || n.wishlistId
        ? `/wishlists/${n.wishlistSlug ?? n.wishlistId}`
        : '/notifications';
    case 'removed_from_wishlist':
      return null;
    default:
      return '/notifications';
  }
}

/** Icon that best represents the notification type. */
export function notificationIcon(n: NotificationView): IconName {
  switch (n.type) {
    case 'follow':
      return 'user';
    case 'wishlist_invite':
      return 'inbox';
    case 'invite_accepted':
      return 'check-circle';
    case 'proposal':
      return 'sparkles';
    case 'proposal_approved':
      return 'check-circle';
    case 'role_changed':
      return 'users';
    case 'removed_from_wishlist':
      return 'logout';
    default:
      return 'bell';
  }
}
